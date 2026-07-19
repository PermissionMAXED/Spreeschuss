package dev.cuprum.cuprum.gametest;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.CuprumItems;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;

/**
 * Server GameTests for the charge probe (CP0 diagnostic infrastructure): place, validate, use, break
 * and verify the loot drop.
 */
public class ChargeProbeGameTest {
    private static final BlockPos PROBE_POS = new BlockPos(1, 1, 1);

    @GameTest
    public void chargeProbePlaceUseBreakDrops(GameTestHelper helper) {
        // Place and validate.
        helper.setBlock(PROBE_POS, CuprumBlocks.CHARGE_PROBE);
        helper.assertBlockPresent(CuprumBlocks.CHARGE_PROBE, PROBE_POS);

        // Server-side use path (prints version + catalog SHA, must not throw).
        helper.useBlock(PROBE_POS, helper.makeMockPlayer(GameType.SURVIVAL));

        // Break with loot drops enabled and verify the probe drops itself.
        helper.getLevel().destroyBlock(helper.absolutePos(PROBE_POS), true);
        helper.assertBlockPresent(Blocks.AIR, PROBE_POS);
        helper.assertItemEntityPresent(CuprumItems.CHARGE_PROBE, PROBE_POS, 2.0);

        helper.succeed();
    }
}
