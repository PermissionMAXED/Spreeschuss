package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.handbook.HandbookWidget;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.util.context.ContextMap;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.display.FurnaceRecipeDisplay;
import net.minecraft.world.item.crafting.display.RecipeDisplay;
import net.minecraft.world.item.crafting.display.ShapedCraftingRecipeDisplay;
import net.minecraft.world.item.crafting.display.ShapelessCraftingRecipeDisplay;
import net.minecraft.world.item.crafting.display.SlotDisplay;
import net.minecraft.world.item.crafting.display.SlotDisplayContext;

/**
 * The {@code recipe} widget renderer over the server-resolved {@code RecipeDisplay}
 * (handbook-config.md §5 — full recipes never reach a 1.21.9 client; the display arrives
 * via {@code cuprum:s2c/handbook/recipes}). Shaped grids, shapeless rows and furnace pairs
 * get slot-by-slot item rendering with multi-item slots cycling every 20 ticks; any other
 * display type falls back to its result stack. A recipe id the server could not resolve
 * renders the localized unavailable notice (asserted absent for shipped W1 content).
 */
final class HandbookRecipeBlock extends HandbookContentBlock {
    static final String UNAVAILABLE_KEY = "handbook.cuprum.recipe_unavailable";
    private static final int CELL = 18;
    private static final int ARROW_WIDTH = 22;
    private static final int COLOR_CELL_BG = 0xFF2A1C14;
    private static final int COLOR_CELL_BORDER = 0xFF4A3628;
    private static final int COLOR_ARROW = 0xFFE0D6CC;
    private static final int CYCLE_TICKS = 20;

    private final HandbookWidget.Recipe widget;
    private final RecipeDisplay display;

    HandbookRecipeBlock(HandbookScreen screen, int width, HandbookWidget.Recipe widget,
            RecipeDisplay display) {
        super(screen, 0, 0, width, blockHeight(display), narration(widget, display));
        this.widget = widget;
        this.display = display;
    }

    private static int blockHeight(RecipeDisplay display) {
        if (display == null) {
            return Minecraft.getInstance().font.lineHeight + 8;
        }
        int rows = display instanceof ShapedCraftingRecipeDisplay shaped ? Math.max(1, shaped.height()) : 1;
        return rows * CELL + 8;
    }

    private static Component narration(HandbookWidget.Recipe widget, RecipeDisplay display) {
        if (display == null) {
            return Component.translatable(UNAVAILABLE_KEY);
        }
        return Component.translatable("handbook.cuprum.recipe_narration",
                resolve(display.result(), 0).getHoverName());
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        if (display == null) {
            guiGraphics.drawString(Minecraft.getInstance().font, Component.translatable(UNAVAILABLE_KEY),
                    getX(), getY() + 4, 0xFFC06050, false);
            renderFocusOutline(guiGraphics);
            return;
        }
        int cycle = (int) (screen.ticksOpen() / CYCLE_TICKS);
        int x = getX();
        int y = getY() + 4;
        switch (display) {
            case ShapedCraftingRecipeDisplay shaped -> {
                int columns = Math.max(1, shaped.width());
                int rows = Math.max(1, shaped.height());
                List<SlotDisplay> ingredients = shaped.ingredients();
                for (int row = 0; row < rows; row++) {
                    for (int column = 0; column < columns; column++) {
                        int index = row * columns + column;
                        SlotDisplay slot = index < ingredients.size() ? ingredients.get(index) : null;
                        renderSlot(guiGraphics, x + column * CELL, y + row * CELL, slot, cycle);
                    }
                }
                int arrowX = x + columns * CELL + 2;
                renderArrow(guiGraphics, arrowX, y + ((rows * CELL) - CELL) / 2 + 5);
                renderSlot(guiGraphics, arrowX + ARROW_WIDTH, y + ((rows * CELL) - CELL) / 2,
                        shaped.result(), cycle);
            }
            case ShapelessCraftingRecipeDisplay shapeless -> {
                List<SlotDisplay> ingredients = shapeless.ingredients();
                for (int i = 0; i < ingredients.size(); i++) {
                    renderSlot(guiGraphics, x + i * CELL, y, ingredients.get(i), cycle);
                }
                int arrowX = x + ingredients.size() * CELL + 2;
                renderArrow(guiGraphics, arrowX, y + 5);
                renderSlot(guiGraphics, arrowX + ARROW_WIDTH, y, shapeless.result(), cycle);
            }
            case FurnaceRecipeDisplay furnace -> {
                renderSlot(guiGraphics, x, y, furnace.ingredient(), cycle);
                renderArrow(guiGraphics, x + CELL + 2, y + 5);
                renderSlot(guiGraphics, x + CELL + 2 + ARROW_WIDTH, y, furnace.result(), cycle);
            }
            default -> renderSlot(guiGraphics, x, y, display.result(), cycle);
        }
        renderFocusOutline(guiGraphics);
    }

    private void renderSlot(GuiGraphics guiGraphics, int x, int y, SlotDisplay slot, int cycle) {
        guiGraphics.fill(x, y, x + CELL, y + CELL, COLOR_CELL_BORDER);
        guiGraphics.fill(x + 1, y + 1, x + CELL - 1, y + CELL - 1, COLOR_CELL_BG);
        if (slot == null) {
            return;
        }
        ItemStack stack = resolve(slot, cycle);
        if (!stack.isEmpty()) {
            guiGraphics.renderItem(stack, x + 1, y + 1);
        }
    }

    private void renderArrow(GuiGraphics guiGraphics, int x, int y) {
        guiGraphics.drawString(Minecraft.getInstance().font, "\u2192", x + 6, y, COLOR_ARROW, false);
    }

    /** The slot's display stack for this cycle step (multi-item slots rotate every 20 ticks). */
    private static ItemStack resolve(SlotDisplay slot, int cycle) {
        Minecraft minecraft = Minecraft.getInstance();
        ContextMap context = minecraft.level != null
                ? SlotDisplayContext.fromLevel(minecraft.level)
                : new ContextMap.Builder().create(SlotDisplayContext.CONTEXT); // both keys optional
        List<ItemStack> stacks = slot.resolveForStacks(context);
        if (stacks.isEmpty()) {
            return ItemStack.EMPTY;
        }
        return stacks.get(Math.floorMod(cycle, stacks.size()));
    }

    /** The recipe id this block documents (client GameTest assertion hook). */
    HandbookWidget.Recipe recipeWidget() {
        return widget;
    }

    /** The first result stack, empty when unresolved (client GameTest assertion hook). */
    ItemStack resultStack() {
        return display == null ? ItemStack.EMPTY : resolve(display.result(), 0);
    }

    @Override
    protected boolean isValidClickButton(MouseButtonInfo buttonInfo) {
        return false;
    }
}
