// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IPolicyTarget {
    function setBand(uint256 minimum, uint256 maximum, uint256 age) external;
}

/// @dev Adversarial owner fixture: changes the vault policy during a token transfer callback.
contract PolicyChangingToken is ERC20 {
    address public callbackVault;
    constructor() ERC20("Callback fixture", "CBK") {
        _mint(msg.sender, 1000000);
    }
    function setTarget(address target_) external {
        callbackVault = target_;
    }
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (callbackVault != address(0) && from != address(0) && to == callbackVault) {
            IPolicyTarget(callbackVault).setBand(101, 200, 1);
        }
    }
}
