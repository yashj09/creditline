// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Stands in for a lending market: "borrow" mints USDC to the caller (inflow), "repay" burns it (outflow).
contract MockVenue {
    MockUSDC public immutable usdc;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function borrow(uint256 amount) external {
        usdc.mint(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(0xdead), amount);
    }
}

/// @dev Stands in for CCTP: burns USDC from caller.
contract MockBridge {
    MockUSDC public immutable usdc;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function burn(uint256 amount, uint32 domain) external {
        domain;
        usdc.transferFrom(msg.sender, address(0xdead), amount);
    }
}

interface IReenter {
    function execute(bytes calldata) external;
}

contract MockReenter {
    address public account;

    function setAccount(address a) external {
        account = a;
    }

    function poke() external {
        // Try to re-enter the account (will fail: not agent / reentrancy guard)
        (bool ok,) = account.call(abi.encodeWithSignature("ownerExecute((address,uint256,bytes)[])", new bytes(0)));
        require(ok, "reenter");
    }
}
