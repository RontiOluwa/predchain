// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PredictionMarket.sol";

/**
 * @title MarketFactory
 * @notice Deploys and registers PredictionMarket contracts.
 *
 * Why a factory?
 * - Single entry point for our off-chain services to track all markets
 * - Enforces consistent configuration (same token, resolver, treasury)
 * - Events make it easy to index all markets from a single contract address
 * - Cheaper than deploying each market independently (shared overhead)
 *
 * Access control:
 * - Only the owner (our backend deployer key) can create markets
 * - The resolver address can be rotated by the owner (for key rotation)
 * - Treasury can be updated by the owner
 */
contract MarketFactory is Ownable {
    // ─── State ───────────────────────────────────────────────────

    /// @notice The ERC-20 token used for all markets (PredToken on testnet)
    address public token;

    /// @notice The address authorised to resolve markets (our Resolution Service wallet)
    address public resolver;

    /// @notice The address that receives protocol fees from all markets
    address public treasury;

    /// @notice marketId → deployed contract address
    mapping(bytes32 => address) public markets;

    /// @notice All deployed market contract addresses in order
    address[] public allMarkets;

    // ─── Events ──────────────────────────────────────────────────
    event MarketCreated(
        bytes32 indexed marketId,
        address indexed marketContract,
        uint256 deadline,
        uint256 timestamp
    );

    event ResolverUpdated(address oldResolver, address newResolver);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    // ─── Constructor ─────────────────────────────────────────────
    constructor(
        address _token,
        address _resolver,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        require(_token != address(0), "MarketFactory: invalid token");
        require(_resolver != address(0), "MarketFactory: invalid resolver");
        require(_treasury != address(0), "MarketFactory: invalid treasury");

        token = _token;
        resolver = _resolver;
        treasury = _treasury;
    }

    // ─── Market Creation ─────────────────────────────────────────

    /**
     * @notice Deploys a new PredictionMarket contract.
     * @dev Only callable by the owner (our backend service).
     *      The marketId must match the UUID stored in our PostgreSQL DB.
     *
     * @param marketId  32-byte market identifier (UUID as bytes32)
     * @param deadline  Unix timestamp when staking closes
     * @return marketAddress  Address of the newly deployed contract
     */
    function createMarket(
        bytes32 marketId,
        uint256 deadline
    ) external onlyOwner returns (address marketAddress) {
        require(
            markets[marketId] == address(0),
            "MarketFactory: market already exists"
        );
        require(
            deadline > block.timestamp,
            "MarketFactory: deadline must be in future"
        );

        PredictionMarket market = new PredictionMarket(
            marketId,
            token,
            resolver,
            treasury,
            deadline
        );

        marketAddress = address(market);
        markets[marketId] = marketAddress;
        allMarkets.push(marketAddress);

        emit MarketCreated(marketId, marketAddress, deadline, block.timestamp);

        return marketAddress;
    }

    // ─── Admin ───────────────────────────────────────────────────

    /**
     * @notice Updates the resolver address for future markets.
     * @dev Existing markets keep their original resolver.
     *      Used for key rotation without redeploying the factory.
     */
    function updateResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "MarketFactory: invalid resolver");
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    /**
     * @notice Updates the treasury address for future markets.
     */
    function updateTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "MarketFactory: invalid treasury");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // ─── Views ───────────────────────────────────────────────────

    /**
     * @notice Returns the total number of markets ever created.
     */
    function marketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    /**
     * @notice Returns the contract address for a given marketId.
     * @dev Returns address(0) if the market doesn't exist.
     */
    function getMarket(bytes32 marketId) external view returns (address) {
        return markets[marketId];
    }

    /**
     * @notice Returns a paginated slice of all market addresses.
     * @dev Avoids returning an unbounded array as the market count grows.
     */
    function getMarkets(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        uint256 total = allMarkets.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory result = new address[](end - offset);

        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allMarkets[i];
        }

        return result;
    }
}
