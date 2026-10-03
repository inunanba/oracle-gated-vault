// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IPriceOracle } from "./IPriceOracle.sol";

/// @title ChainlinkPriceOracle
/// @notice Adapts a Chainlink Data Feed (push oracle) on Hedera to the vault's IPriceOracle surface.
/// @dev Chainlink nodes push rounds on deviation or heartbeat, so no off-chain update is needed.
///      Freshness is enforced by the consumer (OracleGatedVault.maxStaleness), which should be set
///      above the feed's heartbeat.
contract ChainlinkPriceOracle is IPriceOracle {
    AggregatorV3Interface public immutable feed;
    uint8 private immutable _decimals;
    uint8 private immutable _feedDecimals;

    error NonPositivePrice(int256 answer);
    error IncompleteRound(uint80 roundId);

    constructor(address feed_, uint8 decimals_) {
        feed = AggregatorV3Interface(feed_);
        _decimals = decimals_;
        _feedDecimals = AggregatorV3Interface(feed_).decimals();
    }

    /// @notice Latest round answer scaled to `decimals()`; `updatedAt` is the round's update time.
    function latestPrice() external view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer, , uint256 roundUpdatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert NonPositivePrice(answer);
        if (roundUpdatedAt == 0) revert IncompleteRound(roundId);

        uint256 raw = uint256(answer);
        if (_feedDecimals > _decimals) {
            price = raw / 10 ** (_feedDecimals - _decimals);
        } else {
            price = raw * 10 ** (_decimals - _feedDecimals);
        }
        updatedAt = roundUpdatedAt;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return feed.description();
    }
}
