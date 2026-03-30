// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PredToken
 * @notice Testnet staking token for Predchain prediction markets.
 *
 * Faucet logic is handled off-chain via the API gateway.
 * The API enforces 24hr cooldown using Redis, then calls mint()
 * using the deployer wallet. No on-chain faucet needed.
 */
contract PredToken is ERC20, Ownable {
    constructor(
        address initialOwner
    ) ERC20("Predchain Token", "PRED") Ownable(initialOwner) {
        _transferOwnership(initialOwner);
        _mint(initialOwner, 10_000_000 * 10 ** 18);
    }

    /**
     * @notice Mints tokens to any address.
     * @dev Only callable by the owner (deployer wallet via API).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
