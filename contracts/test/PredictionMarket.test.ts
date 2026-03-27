import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { PredToken, MarketFactory, PredictionMarket } from "../typechain-types";

/**
 * Full lifecycle test for PredictionMarket.
 *
 * Tests the complete flow:
 *   Deploy → Stake YES/NO → Lock → Resolve → Claim
 *
 * Uses Hardhat's local network (instant blocks, no gas cost).
 * Run: pnpm test  (from contracts/ directory)
 */
describe("PredictionMarket", () => {
    // ── Test fixtures ────────────────────────────────────────────
    let predToken: PredToken;
    let factory: MarketFactory;
    let market: PredictionMarket;

    let deployer: ReturnType<typeof ethers.getSigner> extends Promise<infer T> ? T : never;
    let resolver: typeof deployer;
    let alice: typeof deployer;
    let bob: typeof deployer;
    let treasury: typeof deployer;

    const MARKET_ID = ethers.encodeBytes32String("test-market-001");
    const STAKE_AMOUNT = ethers.parseEther("100"); // 100 PRED
    const MINT_AMOUNT = ethers.parseEther("10000"); // 10k PRED per user

    /**
     * Deploy fresh contracts before each test.
     * This ensures full isolation — no state bleeds between tests.
     */
    beforeEach(async () => {
        [deployer, resolver, alice, bob, treasury] = await ethers.getSigners();

        // Deploy PredToken
        const PredTokenFactory = await ethers.getContractFactory("PredToken");
        predToken = await PredTokenFactory.deploy(deployer.address);

        // Mint tokens to test users
        await predToken.mint(alice.address, MINT_AMOUNT);
        await predToken.mint(bob.address, MINT_AMOUNT);

        // Deploy MarketFactory
        const FactoryContract = await ethers.getContractFactory("MarketFactory");
        factory = await FactoryContract.deploy(
            await predToken.getAddress(),
            resolver.address,
            treasury.address,
            deployer.address
        );

        // Create a market with deadline 1 hour from now
        const deadline = (await time.latest()) + 3600; // +1 hour
        const tx = await factory.createMarket(MARKET_ID, deadline);
        const receipt = await tx.wait();

        // Get the deployed market address from the MarketCreated event
        const event = receipt?.logs
            .map((log) => {
                try { return factory.interface.parseLog(log); } catch { return null; }
            })
            .find((e) => e?.name === "MarketCreated");

        const marketAddress = event?.args["marketContract"] as string;
        market = await ethers.getContractAt("PredictionMarket", marketAddress);

        // Approve the market contract to spend users' tokens
        await predToken.connect(alice).approve(marketAddress, MINT_AMOUNT);
        await predToken.connect(bob).approve(marketAddress, MINT_AMOUNT);
    });

    // ── Tests ────────────────────────────────────────────────────

    describe("Staking", () => {
        it("allows users to stake YES", async () => {
            await market.connect(alice).stakeYes(STAKE_AMOUNT);

            expect(await market.yesPool()).to.equal(STAKE_AMOUNT);
            expect(await market.yesStakes(alice.address)).to.equal(STAKE_AMOUNT);
        });

        it("allows users to stake NO", async () => {
            await market.connect(bob).stakeNo(STAKE_AMOUNT);

            expect(await market.noPool()).to.equal(STAKE_AMOUNT);
            expect(await market.noStakes(bob.address)).to.equal(STAKE_AMOUNT);
        });

        it("rejects stakes below the minimum", async () => {
            const tooSmall = ethers.parseEther("0.5"); // below 1 PRED minimum
            await expect(
                market.connect(alice).stakeYes(tooSmall)
            ).to.be.revertedWith("PredictionMarket: amount below minimum stake");
        });

        it("rejects stakes after the deadline", async () => {
            // Fast-forward past the deadline
            await time.increase(3601);

            await expect(
                market.connect(alice).stakeYes(STAKE_AMOUNT)
            ).to.be.revertedWith("PredictionMarket: market deadline has passed");
        });

        it("calculates implied probability correctly", async () => {
            await market.connect(alice).stakeYes(ethers.parseEther("75"));
            await market.connect(bob).stakeNo(ethers.parseEther("25"));

            // 75 YES / 100 total = 7500 bps = 75%
            expect(await market.impliedProbabilityYes()).to.equal(7500n);
        });
    });

    describe("Locking", () => {
        it("locks the market after deadline", async () => {
            await market.connect(alice).stakeYes(STAKE_AMOUNT);
            await time.increase(3601); // past deadline

            await market.lock();

            expect(await market.status()).to.equal(1); // Status.LOCKED = 1
        });

        it("prevents locking before deadline", async () => {
            await expect(market.lock()).to.be.revertedWith(
                "PredictionMarket: deadline not reached"
            );
        });
    });

    describe("Resolution and Payout", () => {
        beforeEach(async () => {
            // Standard setup: Alice YES, Bob NO, then lock
            await market.connect(alice).stakeYes(STAKE_AMOUNT);  // 100 PRED YES
            await market.connect(bob).stakeNo(STAKE_AMOUNT);     // 100 PRED NO
            await time.increase(3601);
            await market.lock();
        });

        it("resolves YES and pays out correctly", async () => {
            // Resolve as YES — Alice wins
            await market.connect(resolver).resolve(1); // Outcome.YES = 1

            const aliceBalanceBefore = await predToken.balanceOf(alice.address);
            await market.connect(alice).claimPayout();
            const aliceBalanceAfter = await predToken.balanceOf(alice.address);

            const payout = aliceBalanceAfter - aliceBalanceBefore;

            /**
             * Expected payout calculation:
             *   stake = 100 PRED
             *   winnerShare = (100 / 100) * 100 = 100 PRED
             *   fee = 100 * 2% = 2 PRED
             *   total = 100 + 100 - 2 = 198 PRED
             */
            expect(payout).to.equal(ethers.parseEther("198"));
        });

        it("resolves NO and pays out correctly", async () => {
            await market.connect(resolver).resolve(2); // Outcome.NO = 2

            const bobBalanceBefore = await predToken.balanceOf(bob.address);
            await market.connect(bob).claimPayout();
            const bobBalanceAfter = await predToken.balanceOf(bob.address);

            const payout = bobBalanceAfter - bobBalanceBefore;
            expect(payout).to.equal(ethers.parseEther("198"));
        });

        it("prevents non-resolver from resolving", async () => {
            await expect(
                market.connect(alice).resolve(1)
            ).to.be.revertedWith("PredictionMarket: caller is not resolver");
        });

        it("prevents double claiming", async () => {
            await market.connect(resolver).resolve(1);
            await market.connect(alice).claimPayout();

            await expect(
                market.connect(alice).claimPayout()
            ).to.be.revertedWith("PredictionMarket: already claimed");
        });

        it("prevents losers from claiming payout", async () => {
            await market.connect(resolver).resolve(1); // YES wins

            await expect(
                market.connect(bob).claimPayout() // Bob staked NO
            ).to.be.revertedWith("PredictionMarket: no winning stake");
        });
    });

    describe("Cancellation and Refunds", () => {
        it("resolves VOID and allows full refund", async () => {
            await market.connect(alice).stakeYes(STAKE_AMOUNT);
            await market.connect(bob).stakeNo(STAKE_AMOUNT);
            await time.increase(3601);
            await market.lock();

            await market.connect(resolver).resolve(3); // Outcome.VOID = 3

            // Both users should get full refund (no fees on VOID)
            const aliceBefore = await predToken.balanceOf(alice.address);
            await market.connect(alice).claimRefund();
            const aliceAfter = await predToken.balanceOf(alice.address);

            expect(aliceAfter - aliceBefore).to.equal(STAKE_AMOUNT);
        });
    });

    describe("Factory", () => {
        it("tracks deployed markets correctly", async () => {
            expect(await factory.marketCount()).to.equal(1n);
            expect(await factory.getMarket(MARKET_ID)).to.equal(
                await market.getAddress()
            );
        });

        it("prevents duplicate market IDs", async () => {
            const deadline = (await time.latest()) + 3600;
            await expect(
                factory.createMarket(MARKET_ID, deadline)
            ).to.be.revertedWith("MarketFactory: market already exists");
        });

        it("prevents non-owner from creating markets", async () => {
            const deadline = (await time.latest()) + 3600;
            await expect(
                factory.connect(alice).createMarket(
                    ethers.encodeBytes32String("other-market"),
                    deadline
                )
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });
});