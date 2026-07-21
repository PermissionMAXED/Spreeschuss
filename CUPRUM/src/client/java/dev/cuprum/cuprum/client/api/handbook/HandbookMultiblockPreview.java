package dev.cuprum.cuprum.client.api.handbook;

import dev.cuprum.cuprum.handbook.HandbookWidget;
import java.util.List;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Block;

/**
 * FROZEN CLIENT API (plan D5 freeze surface; TOOL-11/W10 contractually reuses this renderer):
 * the flat per-layer item-grid multiblock preview — the pinned T3 floor and the screenshot
 * target (plan D10 staged the isometric {@code SpecialGuiElementRegistry} PiP path to
 * W4/TOOL-11). One layer is drawn at a time as a north-up grid of block-item icons;
 * {@code layers} are bottom-up, rows run north to south, columns west to east, a space is an
 * empty cell (exactly the {@link HandbookWidget.Multiblock} data contract).
 */
public final class HandbookMultiblockPreview {
    /** Grid cell edge in GUI px (16 px item + 1 px gutter each side). */
    public static final int CELL_SIZE = 18;

    private static final int COLOR_CELL_BG = 0xFF2A1C14;
    private static final int COLOR_CELL_BORDER = 0xFF4A3628;

    private HandbookMultiblockPreview() {
    }

    /** Pixel width of the widest row of {@code layer} (index into the widget's layer list). */
    public static int layerWidth(HandbookWidget.Multiblock widget, int layerIndex) {
        List<String> rows = widget.layers().get(layerIndex);
        int columns = 0;
        for (String row : rows) {
            columns = Math.max(columns, row.length());
        }
        return columns * CELL_SIZE;
    }

    /** Pixel height of {@code layer} (one cell row per row string). */
    public static int layerHeight(HandbookWidget.Multiblock widget, int layerIndex) {
        return widget.layers().get(layerIndex).size() * CELL_SIZE;
    }

    /** Largest layer footprint across the whole structure (stable widget bounds while stepping). */
    public static int maxLayerWidth(HandbookWidget.Multiblock widget) {
        int max = 0;
        for (int i = 0; i < widget.layers().size(); i++) {
            max = Math.max(max, layerWidth(widget, i));
        }
        return max;
    }

    public static int maxLayerHeight(HandbookWidget.Multiblock widget) {
        int max = 0;
        for (int i = 0; i < widget.layers().size(); i++) {
            max = Math.max(max, layerHeight(widget, i));
        }
        return max;
    }

    /**
     * Renders one layer's flat grid with its top-left cell at {@code (x, y)}. Unknown palette
     * block ids render as a barrier icon (never a crash — content is server data and may be
     * modified by packs).
     */
    public static void render(GuiGraphics guiGraphics, HandbookWidget.Multiblock widget,
            int layerIndex, int x, int y) {
        List<String> rows = widget.layers().get(layerIndex);
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            String row = rows.get(rowIndex);
            for (int column = 0; column < row.length(); column++) {
                char cell = row.charAt(column);
                if (cell == ' ') {
                    continue;
                }
                int cellX = x + column * CELL_SIZE;
                int cellY = y + rowIndex * CELL_SIZE;
                guiGraphics.fill(cellX, cellY, cellX + CELL_SIZE, cellY + CELL_SIZE, COLOR_CELL_BORDER);
                guiGraphics.fill(cellX + 1, cellY + 1, cellX + CELL_SIZE - 1, cellY + CELL_SIZE - 1,
                        COLOR_CELL_BG);
                guiGraphics.renderItem(stackFor(widget.palette().get(String.valueOf(cell))),
                        cellX + 1, cellY + 1);
            }
        }
    }

    /** The display stack for a palette block id; barrier for unknown/itemless blocks. */
    public static ItemStack stackFor(ResourceLocation blockId) {
        return BuiltInRegistries.BLOCK.getOptional(blockId)
                .map(Block::asItem)
                .filter(item -> item != Items.AIR)
                .map(ItemStack::new)
                .orElseGet(() -> new ItemStack(Items.BARRIER));
    }
}
