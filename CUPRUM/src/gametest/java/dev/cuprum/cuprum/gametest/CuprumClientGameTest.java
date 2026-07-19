package dev.cuprum.cuprum.gametest;

import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.minecraft.client.gui.screens.TitleScreen;

/**
 * Client smoke test: boots a real client (under Xvfb in headless environments),
 * captures a title screen screenshot, then creates a singleplayer world, places the
 * charge probe in front of the player and screenshots it in-world. Screenshots land
 * in build/run/clientGameTest/screenshots.
 */
public class CuprumClientGameTest implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        context.waitForScreen(TitleScreen.class);
        context.takeScreenshot("cuprum_title_screen");

        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            // Stand the player on a fixed spot facing +Z and place the probe in view.
            singleplayer.getServer().runCommand("tp @p 0.5 -60 0.5 0 25");
            singleplayer.getServer().runCommand("setblock 0 -60 3 cuprum:charge_probe");
            context.waitTicks(20);

            context.takeScreenshot("cuprum_charge_probe_in_world");
        }
    }
}
