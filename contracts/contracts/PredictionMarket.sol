// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionMarket
 * @notice A single binary prediction market.
 *
 * Lifecycle:
 *   OPEN → users stake YES or NO
 *   LOCKED → deadline passed, no new stakes
 *   RESOLVED → resolver calls resolve() with outcome
 *   SETTLED → winners have claimed payouts
 *   CANCELLED → market voided, all stakes refunded
 *
 * Payout formula (proportional share of the losing pool):
 *   payout = stake + (stake / winningPool) * losingPool * (1 - PROTOCOL_FEE)
 *
 * The resolver role is held by the MarketFactory's designated resolver address
 * (our off-chain Resolution Service). In production, this would be a
 * multi-sig or a DAO governance contract.
 */
contract PredictionMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ───────────────────────────────────────────────────
    enum Status {
        OPEN,
        LOCKED,
        RESOLVED,
        CANCELLED
    }
    enum Outcome {
        NONE,
        YES,
        NO,
        VOID
    }

    // ─── Constants ───────────────────────────────────────────────
    /// @notice Protocol fee: 2% of the losing pool goes to the protocol treasury
    uint256 public constant PROTOCOL_FEE_BPS = 200; // 200 basis points = 2%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Minimum stake per position to prevent dust attacks
    uint256 public constant MIN_STAKE = 1 * 10 ** 18; // 1 PRED

    // ─── Immutables (set at construction, never change) ───────────
    /// @notice The ERC-20 token used for staking
    IERC20 public immutable token;

    /// @notice The address authorised to call resolve()
    address public immutable resolver;

    /// @notice The address that receives protocol fees
    address public immutable treasury;

    /// @notice Unique market ID (matches the DB record UUID)
    bytes32 public immutable marketId;

    /// @notice Timestamp after which no new stakes are accepted
    uint256 public immutable deadline;

    // ─── State ───────────────────────────────────────────────────
    Status public status;
    Outcome public outcome;

    /// @notice Total tokens staked on YES
    uint256 public yesPool;

    /// @notice Total tokens staked on NO
    uint256 public noPool;

    /// @notice Individual YES stakes per address
    mapping(address => uint256) public yesStakes;

    /// @notice Individual NO stakes per address
    mapping(address => uint256) public noStakes;

    /// @notice Tracks whether an address has claimed their payout
    mapping(address => bool) public hasClaimed;

    // ─── Events ──────────────────────────────────────────────────
    event Staked(address indexed user, bool isYes, uint256 amount);
    event Resolved(Outcome outcome);
    event PayoutClaimed(address indexed user, uint256 amount);
    event Refunded(address indexed user, uint256 amount);
    event Cancelled(string reason);

    // ─── Modifiers ───────────────────────────────────────────────
    modifier onlyResolver() {
        require(
            msg.sender == resolver,
            "PredictionMarket: caller is not resolver"
        );
        _;
    }

    modifier onlyStatus(Status expected) {
        require(
            status == expected,
            "PredictionMarket: invalid status for this action"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────
    constructor(
        bytes32 _marketId,
        address _token,
        address _resolver,
        address _treasury,
        uint256 _deadline
    ) {
        require(
            _deadline > block.timestamp,
            "PredictionMarket: deadline must be in the future"
        );
        require(_resolver != address(0), "PredictionMarket: invalid resolver");
        require(_treasury != address(0), "PredictionMarket: invalid treasury");

        marketId = _marketId;
        token = IERC20(_token);
        resolver = _resolver;
        treasury = _treasury;
        deadline = _deadline;
        status = Status.OPEN;
    }

    // ─── Staking ─────────────────────────────────────────────────

    /**
     * @notice Stake tokens on YES outcome.
     * @param amount Amount of tokens to stake (in wei, 18 decimals).
     *
     * The caller must first approve this contract to spend their tokens:
     *   token.approve(marketAddress, amount)
     */
    function stakeYes(
        uint256 amount
    ) external nonReentrant onlyStatus(Status.OPEN) {
        require(
            block.timestamp < deadline,
            "PredictionMarket: market deadline has passed"
        );
        require(
            amount >= MIN_STAKE,
            "PredictionMarket: amount below minimum stake"
        );

        yesStakes[msg.sender] += amount;
        yesPool += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, true, amount);
    }

    /**
     * @notice Stake tokens on NO outcome.
     * @param amount Amount of tokens to stake (in wei, 18 decimals).
     */
    function stakeNo(
        uint256 amount
    ) external nonReentrant onlyStatus(Status.OPEN) {
        require(
            block.timestamp < deadline,
            "PredictionMarket: market deadline has passed"
        );
        require(
            amount >= MIN_STAKE,
            "PredictionMarket: amount below minimum stake"
        );

        noStakes[msg.sender] += amount;
        noPool += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, false, amount);
    }

    // ─── Resolution ──────────────────────────────────────────────

    /**
     * @notice Locks the market after the deadline.
     * @dev Anyone can call this once the deadline has passed.
     *      Separates the "lock" action from "resolve" so the resolver
     *      has time to fetch oracle data after staking closes.
     */
    function lock() external onlyStatus(Status.OPEN) {
        require(
            block.timestamp >= deadline,
            "PredictionMarket: deadline not reached"
        );
        status = Status.LOCKED;
    }

    /**
     * @notice Resolves the market with the given outcome.
     * @dev Only callable by the designated resolver address.
     *      This is called by our off-chain Resolution Service after
     *      the AI agent evaluates the oracle data.
     *
     * @param _outcome YES, NO, or VOID
     *
     * If VOID: all stakes are refunded (cancel path).
     * If YES or NO: winners can claim proportional payouts.
     */
    function resolve(
        Outcome _outcome
    ) external onlyResolver onlyStatus(Status.LOCKED) {
        require(_outcome != Outcome.NONE, "PredictionMarket: invalid outcome");

        outcome = _outcome;

        if (_outcome == Outcome.VOID) {
            status = Status.CANCELLED;
            emit Cancelled("Market resolved as VOID by resolver");
        } else {
            status = Status.RESOLVED;
        }

        emit Resolved(_outcome);
    }

    // ─── Payouts ─────────────────────────────────────────────────

    /**
     * @notice Claims the caller's payout from a resolved market.
     * @dev Uses the pull-payment pattern — users call this themselves
     *      rather than the contract pushing payments. Safer and cheaper.
     *
     * Payout formula:
     *   baseReturn = user's stake (always returned)
     *   winnerShare = (userStake / winningPool) * losingPool
     *   fee = winnerShare * PROTOCOL_FEE_BPS / BPS_DENOMINATOR
     *   totalPayout = baseReturn + winnerShare - fee
     *
     * If the losing pool is empty (everyone staked the same side),
     * winners simply get their stake back.
     */
    function claimPayout() external nonReentrant onlyStatus(Status.RESOLVED) {
        require(!hasClaimed[msg.sender], "PredictionMarket: already claimed");

        uint256 userStake = outcome == Outcome.YES
            ? yesStakes[msg.sender]
            : noStakes[msg.sender];

        require(userStake > 0, "PredictionMarket: no winning stake");

        hasClaimed[msg.sender] = true;

        uint256 winningPool = outcome == Outcome.YES ? yesPool : noPool;
        uint256 losingPool = outcome == Outcome.YES ? noPool : yesPool;

        uint256 winnerShare = (userStake * losingPool) / winningPool;
        uint256 fee = (winnerShare * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalPayout = userStake + winnerShare - fee;

        // Send protocol fee to treasury
        if (fee > 0) {
            token.safeTransfer(treasury, fee);
        }

        token.safeTransfer(msg.sender, totalPayout);

        emit PayoutClaimed(msg.sender, totalPayout);
    }

    /**
     * @notice Refunds the caller's stake from a cancelled/voided market.
     */
    function claimRefund() external nonReentrant onlyStatus(Status.CANCELLED) {
        require(!hasClaimed[msg.sender], "PredictionMarket: already claimed");

        uint256 refundAmount = yesStakes[msg.sender] + noStakes[msg.sender];
        require(refundAmount > 0, "PredictionMarket: no stake to refund");

        hasClaimed[msg.sender] = true;

        token.safeTransfer(msg.sender, refundAmount);

        emit Refunded(msg.sender, refundAmount);
    }

    // ─── Views ───────────────────────────────────────────────────

    /**
     * @notice Returns the current implied probability of YES (0–10000 = 0–100%).
     * @dev Simple AMM: probability = yesPool / totalPool.
     *      Returns 5000 (50%) if no stakes exist yet.
     */
    function impliedProbabilityYes() external view returns (uint256) {
        uint256 total = yesPool + noPool;
        if (total == 0) return 5_000;
        return (yesPool * 10_000) / total;
    }

    /**
     * @notice Returns a summary of the market's current state.
     */
    function getMarketInfo()
        external
        view
        returns (
            Status _status,
            Outcome _outcome,
            uint256 _yesPool,
            uint256 _noPool,
            uint256 _deadline,
            uint256 _probabilityYes
        )
    {
        uint256 total = yesPool + noPool;
        uint256 prob = total == 0 ? 5_000 : (yesPool * 10_000) / total;
        return (status, outcome, yesPool, noPool, deadline, prob);
    }
}
