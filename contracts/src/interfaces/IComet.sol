// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Compound v3 (Comet) interface used by Mandate.
interface IComet {
    struct AssetInfo {
        uint8 offset;
        address asset;
        address priceFeed;
        uint64 scale;
        uint64 borrowCollateralFactor;
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }

    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function baseToken() external view returns (address);
    function baseTokenPriceFeed() external view returns (address);
    function borrowBalanceOf(address account) external view returns (uint256);
    function collateralBalanceOf(address account, address asset) external view returns (uint128);
    function getAssetInfoByAddress(address asset) external view returns (AssetInfo memory);
    function getPrice(address priceFeed) external view returns (uint256);
    function getUtilization() external view returns (uint256);
    function getBorrowRate(uint256 utilization) external view returns (uint64);
    function isBorrowCollateralized(address account) external view returns (bool);
}
