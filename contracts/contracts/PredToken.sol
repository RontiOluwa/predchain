// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PredToken
 * @notice Testnet staking token for Predchain prediction markets.
 *
 * This is a simple ERC-20 with a public faucet function.
 * Anyone can call faucet() to get tokens for testing.
 *
 * In production, this would be replaced by a real token (e.g. USDC)
 * by simply changing the token address in the MarketFactory.
 * All market logic is token-agnostic.
 */
contract PredToken is ERC20, Ownable {
    /// @notice Amount dispensed per faucet call: 1,000 PRED
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 18;

    /// @notice Cooldown between faucet calls per address (24 hours)
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    /// @notice Tracks the last time each address used the faucet
    mapping(address => uint256) public lastFaucetTime;

    /**
     * @dev Mints 10,000,000 PRED to the deployer on construction.
     * The deployer can distribute tokens to test accounts.
     */
    constructor(address initialOwner)
        ERC20("Predchain Token", "PRED")
        Ownable(initialOwner)
    {
        _mint(initialOwner, 10_000_000 * 10 ** 18);
    }

    /**
     * @notice Dispenses 1,000 PRED to the caller once every 24 hours.
     * @dev No authentication needed — this is a testnet faucet.
     */
    function faucet() external {
        require(
            block.timestamp >= lastFaucetTime[msg.sender] + FAUCET_COOLDOWN,
            "PredToken: faucet cooldown active, wait 24 hours"
        );

        lastFaucetTime[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Owner can mint arbitrary amounts.
     * Used to fund test accounts during development.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
