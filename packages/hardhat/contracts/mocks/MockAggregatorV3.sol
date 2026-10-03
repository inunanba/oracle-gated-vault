// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "../oracle/interfaces/AggregatorV3Interface.sol";

/// @notice Test double for a Chainlink Data Feed.
contract MockAggregatorV3 is AggregatorV3Interface {
    uint8 public immutable decimals;
    string public description;
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        decimals = decimals_;
        description = description_;
        setRound(initialAnswer, block.timestamp);
    }

    function setRound(int256 answer, uint256 updatedAt) public {
        _roundId++;
        _answer = answer;
        _updatedAt = updatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
