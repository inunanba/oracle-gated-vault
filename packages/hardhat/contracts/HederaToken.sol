// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title HederaToken (HTK)
/// @notice Demo ERC-20 used as the vault asset. Anyone can mint a small amount through
///         `faucet()` so visitors of a public testnet deployment can try the vault.
///         Replace with your real asset (an HTS token's ERC-20 facade works the same way).
contract HederaToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 100 ether;

    constructor(address initialOwner) ERC20("HederaToken", "HTK") Ownable(initialOwner) {
        _mint(initialOwner, 10000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /// @notice Mints FAUCET_AMOUNT to the caller. Demo only; remove for a real asset.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
