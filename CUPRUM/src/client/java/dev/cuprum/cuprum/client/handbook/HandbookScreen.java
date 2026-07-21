package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.handbook.HandbookCategory;
import dev.cuprum.cuprum.handbook.HandbookPage;
import dev.cuprum.cuprum.handbook.HandbookWidget;
import dev.cuprum.cuprum.state.CuprumAttachments;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import org.lwjgl.glfw.GLFW;

/**
 * The in-game handbook (handbook-config.md §5): a plain {@link Screen} subclass (no
 * MenuType/handler — vanilla-correct for book UIs), rendering only the client cache synced
 * from the server. Navigation is category grid → page list → page view with an explicit
 * back stack (Esc pops, root Esc closes); every view lives in one scrolled, scissored
 * content region whose layout is recomputed from the window size in {@link #init()} —
 * responsive across window resizes and GUI-scale changes.
 *
 * <p>Late join / reload / missing page: {@link #tick()} watches the cache generation and
 * rebuilds in place; a page that vanished in a datapack reload shows the localized
 * missing-page notice instead of stale content. Locked pages (client-side re-evaluation of
 * the server-truth attachment key set) show the lock notice and zero content widgets.
 *
 * <p>Accessibility (§7): every content block is a {@code NarratableEntry}, Tab/arrow focus
 * traversal is vanilla and always on, focused blocks draw an outline and auto-scroll into
 * view, the scoreboard-independent keys (PageUp/PageDown/Home/End) scroll, and lock states
 * are shape-coded (glyph + color) when {@code shapeCodedIndicators} is enabled.
 */
public final class HandbookScreen extends Screen {
    public static final String TITLE_KEY = "handbook.cuprum.title";
    static final String LOCKED_NOTICE_KEY = "handbook.cuprum.locked_notice";
    static final String MISSING_NOTICE_KEY = "handbook.cuprum.page_missing";
    static final String EMPTY_NOTICE_KEY = "handbook.cuprum.empty";
    static final String NO_RESULTS_KEY = "handbook.cuprum.no_results";

    private static final int COLOR_TITLE = 0xFFE8A33C;
    private static final int COLOR_TEXT = 0xFFE0D6CC;
    private static final int COLOR_LOCKED = 0xFF8A7C70;
    private static final int COLOR_PANEL_BG = 0xE0181008;
    private static final int COLOR_SCROLLBAR = 0xFF4A3628;
    private static final int COLOR_SCROLLBAR_THUMB = 0xFFB7683C;
    private static final int ROW_GAP = 4;
    private static final int SCROLL_STEP = 12;

    /** One navigation location; the back stack holds the path from the landing view. */
    private sealed interface View permits LandingView, CategoryView, PageView {
    }

    private record LandingView() implements View {
    }

    private record CategoryView(ResourceLocation categoryId) implements View {
    }

    private record PageView(ResourceLocation pageId) implements View {
    }

    private final Deque<View> backStack = new ArrayDeque<>();
    private View view = new LandingView();

    private final List<AbstractWidget> contentWidgets = new ArrayList<>();
    private final List<Integer> contentVirtualY = new ArrayList<>();
    private String searchQuery = "";
    private double scrollAmount;
    private int virtualContentHeight;
    private boolean contentDirty;
    private int builtGeneration = -1;
    private boolean builtLocked;
    private long ticksOpen;

    private EditBox searchBox;
    private int contentLeft;
    private int contentWidth;
    private int contentTop;
    private int contentBottom;

    public HandbookScreen() {
        super(Component.translatable(TITLE_KEY));
    }

    /** Deep-link constructor: opens directly on {@code pageId} with landing underneath. */
    public HandbookScreen(ResourceLocation pageId) {
        this();
        backStack.push(new LandingView());
        view = new PageView(pageId);
    }

    @Override
    protected void init() {
        contentWidth = Math.min(width - 32, 440);
        contentLeft = (width - contentWidth) / 2;
        contentBottom = height - 10;
        buildLayout();
    }

    /** Full re-layout: header widgets + the current view's scrolled content list. */
    private void buildLayout() {
        clearWidgets();
        contentWidgets.clear();
        contentVirtualY.clear();
        searchBox = null;
        contentDirty = false;
        builtGeneration = HandbookClientCache.snapshot().generation();
        builtLocked = currentPageLocked();

        int headerY = 8;
        if (!(view instanceof LandingView)) {
            addRenderableWidget(Button.builder(Component.translatable("handbook.cuprum.back"),
                            button -> goBack())
                    .bounds(contentLeft, headerY, 50, 20).build());
        }
        if (view instanceof PageView pageView
                && HandbookClientCache.snapshot().page(pageView.pageId()).isPresent()) {
            addRenderableWidget(bookmarkButton(pageView.pageId(), headerY));
        }

        int cursor = headerY + 20 + 8;
        if (view instanceof LandingView) {
            searchBox = new EditBox(font, contentLeft, cursor, contentWidth, 18,
                    Component.translatable("handbook.cuprum.search"));
            searchBox.setHint(Component.translatable("handbook.cuprum.search_hint"));
            searchBox.setMaxLength(64);
            searchBox.setValue(searchQuery);
            searchBox.setResponder(query -> {
                if (!query.equals(searchQuery)) {
                    searchQuery = query;
                    contentDirty = true; // rebuilt in tick(): never mutate children mid-dispatch
                }
            });
            addRenderableWidget(searchBox);
            cursor += 18 + 8;
        }
        contentTop = cursor;

        switch (view) {
            case LandingView ignored when !searchQuery.isBlank() -> buildSearchResults();
            case LandingView ignored -> buildLanding();
            case CategoryView categoryView -> buildCategoryListing(categoryView.categoryId());
            case PageView pageView -> buildPage(pageView.pageId());
        }
        layoutContent();
    }

    private Button bookmarkButton(ResourceLocation pageId, int headerY) {
        return new BookmarkButton(this, contentLeft + contentWidth - 20, headerY, pageId);
    }

    /** The header star toggle; glyph shape-coded (§7): {@code *} bookmarked vs {@code +} not. */
    private static final class BookmarkButton extends Button {
        private final ResourceLocation pageId;

        BookmarkButton(HandbookScreen screen, int x, int y, ResourceLocation pageId) {
            super(x, y, 20, 20, Component.empty(), button -> {
                HandbookBookmarks.toggle(worldKey(), pageId);
                screen.contentDirty = true;
            }, DEFAULT_NARRATION);
            this.pageId = pageId;
        }

        @Override
        public Component getMessage() {
            return Component.literal(
                    HandbookBookmarks.isBookmarked(worldKey(), pageId) ? "*" : "+");
        }

        @Override
        protected net.minecraft.network.chat.MutableComponent createNarrationMessage() {
            return Component.translatable("gui.narrate.button", Component.translatable(
                    HandbookBookmarks.isBookmarked(worldKey(), pageId)
                            ? "handbook.cuprum.bookmark_remove" : "handbook.cuprum.bookmark_add"));
        }
    }

    // ------------------------------------------------------------------ view builders

    private void buildLanding() {
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        if (snapshot.categories().isEmpty()) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable(EMPTY_NOTICE_KEY), false));
            return;
        }
        for (HandbookCategory category : snapshot.categories()) {
            addContent(new HandbookListButton(this, contentWidth,
                    Component.translatable(category.titleKey()), iconStack(category.icon()),
                    COLOR_TEXT, button -> navigateTo(new CategoryView(category.id()))));
        }
        List<ResourceLocation> bookmarks = HandbookBookmarks.bookmarks(worldKey());
        if (!bookmarks.isEmpty()) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable("handbook.cuprum.bookmarks"), true));
            for (ResourceLocation pageId : bookmarks) {
                Optional<HandbookPage> page = snapshot.page(pageId);
                Component label = page.map(p -> (Component) Component.translatable(p.titleKey()))
                        .orElseGet(() -> Component.literal(pageId.toString()));
                addContent(new HandbookListButton(this, contentWidth, label,
                        page.map(this::pageIcon).orElse(ItemStack.EMPTY), COLOR_TEXT,
                        button -> navigateTo(new PageView(pageId))));
            }
        }
    }

    private void buildSearchResults() {
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        List<ResourceLocation> hits = HandbookSearchIndex.search(searchQuery);
        if (hits.isEmpty()) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable(NO_RESULTS_KEY), false));
            return;
        }
        for (ResourceLocation pageId : hits) {
            snapshot.page(pageId).ifPresent(page -> addContent(pageRow(page)));
        }
    }

    private void buildCategoryListing(ResourceLocation categoryId) {
        List<HandbookPage> pages = HandbookClientCache.snapshot().pagesIn(categoryId);
        if (pages.isEmpty()) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable(EMPTY_NOTICE_KEY), false));
            return;
        }
        pages.forEach(page -> addContent(pageRow(page)));
    }

    private HandbookListButton pageRow(HandbookPage page) {
        boolean locked = !page.unlock().test(clientUnlockedKeys());
        Component title = Component.translatable(page.titleKey());
        if (locked && CuprumClientConfigs.client().shapeCodedIndicators) {
            // Shape + color (§7): the glyph carries the state for colorblind players.
            title = Component.literal("[x] ").append(title);
        }
        return new HandbookListButton(this, contentWidth, title,
                locked ? ItemStack.EMPTY : pageIcon(page), locked ? COLOR_LOCKED : COLOR_TEXT,
                button -> navigateTo(new PageView(page.id())));
    }

    private void buildPage(ResourceLocation pageId) {
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        Optional<HandbookPage> resolved = snapshot.page(pageId);
        if (resolved.isEmpty()) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable(MISSING_NOTICE_KEY), true));
            return;
        }
        HandbookPage page = resolved.get();
        addContent(HandbookTextBlock.notice(this, contentWidth,
                Component.translatable(page.titleKey()), true));
        if (!page.unlock().test(clientUnlockedKeys())) {
            addContent(HandbookTextBlock.notice(this, contentWidth,
                    Component.translatable(LOCKED_NOTICE_KEY), false));
            return; // locked ⇒ lock notice, zero content widgets (handbook-config.md §5)
        }
        for (HandbookWidget widget : page.widgets()) {
            addContent(switch (widget) {
                case HandbookWidget.Text text -> HandbookTextBlock.of(this, contentWidth, text);
                case HandbookWidget.Image image -> new HandbookImageBlock(this, contentWidth, image);
                case HandbookWidget.Recipe recipe -> new HandbookRecipeBlock(this, contentWidth,
                        recipe, snapshot.recipe(recipe.recipe()).orElse(null));
                case HandbookWidget.Multiblock multiblock ->
                        new HandbookMultiblockBlock(this, contentWidth, multiblock);
                case HandbookWidget.Charge charge -> new HandbookChargeBlock(this, contentWidth, charge);
            });
        }
        HandbookClientModule.rememberLastPage(pageId);
    }

    // ------------------------------------------------------------------ content plumbing

    private void addContent(AbstractWidget widget) {
        contentWidgets.add(widget);
        addWidget(widget); // children + narration only; rendering happens inside the scissor
    }

    /** Stacks content top-down, then applies the (clamped) scroll offset. */
    private void layoutContent() {
        int cursor = 0;
        contentVirtualY.clear();
        for (AbstractWidget widget : contentWidgets) {
            contentVirtualY.add(cursor);
            cursor += widget.getHeight() + ROW_GAP;
        }
        virtualContentHeight = cursor;
        applyScroll();
    }

    private void applyScroll() {
        scrollAmount = Math.max(0, Math.min(scrollAmount, maxScroll()));
        for (int i = 0; i < contentWidgets.size(); i++) {
            AbstractWidget widget = contentWidgets.get(i);
            widget.setX(contentLeft);
            widget.setY(contentTop + contentVirtualY.get(i) - (int) scrollAmount);
        }
    }

    private int maxScroll() {
        return Math.max(0, virtualContentHeight - (contentBottom - contentTop));
    }

    /** Input guard shared by every content widget: only visible rows are clickable. */
    boolean isInContentRegion(double mouseY) {
        return mouseY >= contentTop && mouseY < contentBottom;
    }

    /** Scrolls a keyboard-focused block fully into the visible region (§7). */
    void ensureVisible(AbstractWidget widget) {
        int index = contentWidgets.indexOf(widget);
        if (index < 0) {
            return;
        }
        int top = contentVirtualY.get(index);
        int bottom = top + widget.getHeight();
        int viewHeight = contentBottom - contentTop;
        if (top - scrollAmount < 0) {
            scrollAmount = top;
        } else if (bottom - scrollAmount > viewHeight) {
            scrollAmount = bottom - viewHeight;
        }
        applyScroll();
    }

    // ------------------------------------------------------------------ navigation

    private void navigateTo(View next) {
        backStack.push(view);
        view = next;
        scrollAmount = 0;
        contentDirty = true;
    }

    private void goBack() {
        if (backStack.isEmpty()) {
            onClose();
            return;
        }
        view = backStack.pop();
        scrollAmount = 0;
        contentDirty = true;
    }

    // ------------------------------------------------------------------ vanilla hooks

    @Override
    public void tick() {
        ticksOpen++;
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        if (snapshot.generation() != builtGeneration || builtLocked != currentPageLocked()) {
            contentDirty = true; // reload/late sync/unlock underneath the open screen
        }
        if (contentDirty) {
            buildLayout();
        }
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if (event.isEscape()) {
            goBack();
            return true;
        }
        int viewHeight = contentBottom - contentTop;
        switch (event.key()) {
            case GLFW.GLFW_KEY_PAGE_DOWN -> {
                scrollAmount += viewHeight;
                applyScroll();
                return true;
            }
            case GLFW.GLFW_KEY_PAGE_UP -> {
                scrollAmount -= viewHeight;
                applyScroll();
                return true;
            }
            case GLFW.GLFW_KEY_END -> {
                scrollAmount = maxScroll();
                applyScroll();
                return true;
            }
            case GLFW.GLFW_KEY_HOME -> {
                scrollAmount = 0;
                applyScroll();
                return true;
            }
            default -> {
                return super.keyPressed(event);
            }
        }
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (isInContentRegion(mouseY)) {
            scrollAmount -= scrollY * SCROLL_STEP;
            applyScroll();
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        super.render(guiGraphics, mouseX, mouseY, partialTick);
        guiGraphics.fill(contentLeft - 6, contentTop - 4, contentLeft + contentWidth + 6,
                contentBottom + 4, COLOR_PANEL_BG);
        guiGraphics.drawString(font, breadcrumb(),
                contentLeft + (view instanceof LandingView ? 0 : 56), 14, COLOR_TITLE, false);

        guiGraphics.enableScissor(contentLeft - 4, contentTop, contentLeft + contentWidth + 4,
                contentBottom);
        for (AbstractWidget widget : contentWidgets) {
            widget.render(guiGraphics, mouseX, mouseY, partialTick);
        }
        guiGraphics.disableScissor();

        if (maxScroll() > 0) {
            int barX = contentLeft + contentWidth + 5;
            int trackHeight = contentBottom - contentTop;
            int thumbHeight = Math.max(8, trackHeight * trackHeight / virtualContentHeight);
            int thumbY = contentTop
                    + (int) ((trackHeight - thumbHeight) * (scrollAmount / maxScroll()));
            guiGraphics.fill(barX, contentTop, barX + 2, contentBottom, COLOR_SCROLLBAR);
            guiGraphics.fill(barX, thumbY, barX + 2, thumbY + thumbHeight, COLOR_SCROLLBAR_THUMB);
        }
    }

    /** Breadcrumb header: Handbook › Category › Page (localized at every level). */
    private Component breadcrumb() {
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        return switch (view) {
            case LandingView ignored -> getTitle();
            case CategoryView categoryView -> snapshot.categories().stream()
                    .filter(category -> category.id().equals(categoryView.categoryId()))
                    .findFirst()
                    .map(category -> join(getTitle(), Component.translatable(category.titleKey())))
                    .orElse(getTitle());
            case PageView pageView -> snapshot.page(pageView.pageId())
                    .map(page -> join(getTitle(), Component.translatable(page.titleKey())))
                    .orElseGet(() -> join(getTitle(), Component.translatable(MISSING_NOTICE_KEY)));
        };
    }

    private static Component join(Component left, Component right) {
        return Component.empty().append(left).append(Component.literal(" \u203A ")).append(right);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // reference book; the world keeps running (also keeps MP parity)
    }

    // ------------------------------------------------------------------ shared lookups

    private boolean currentPageLocked() {
        if (!(view instanceof PageView pageView)) {
            return false;
        }
        return HandbookClientCache.snapshot().page(pageView.pageId())
                .map(page -> !page.unlock().test(clientUnlockedKeys()))
                .orElse(false);
    }

    /** The synced server-truth unlock key set mirrored onto the local player (targetOnly). */
    static Set<ResourceLocation> clientUnlockedKeys() {
        LocalPlayer player = Minecraft.getInstance().player;
        return player == null ? Set.of()
                : player.getAttachedOrElse(CuprumAttachments.HANDBOOK_UNLOCKS, Set.of());
    }

    private static String worldKey() {
        return HandbookBookmarks.worldKey(Minecraft.getInstance());
    }

    private ItemStack iconStack(ResourceLocation itemId) {
        return BuiltInRegistries.ITEM.getOptional(itemId)
                .map(ItemStack::new)
                .orElse(ItemStack.EMPTY);
    }

    private ItemStack pageIcon(HandbookPage page) {
        return page.subjects().isEmpty() ? ItemStack.EMPTY : iconStack(page.subjects().get(0));
    }

    // ------------------------------------------------------------------ test hooks (client GameTests)

    /** Stable view descriptor: {@code landing}, {@code category:<id>} or {@code page:<id>}. */
    public String viewDescriptor() {
        return switch (view) {
            case LandingView ignored -> "landing";
            case CategoryView categoryView -> "category:" + categoryView.categoryId();
            case PageView pageView -> "page:" + pageView.pageId();
        };
    }

    /** Drives the search box programmatically (client thread; results rebuild next tick). */
    public void searchNow(String query) {
        if (searchBox != null) {
            searchBox.setValue(query);
        }
    }

    /** Current scrolled content blocks, top-down (assertion hook). */
    public List<AbstractWidget> contentBlocks() {
        return List.copyOf(contentWidgets);
    }

    /** Opens a page directly (deep-link path used by the client API + tests). */
    public void openPage(ResourceLocation pageId) {
        navigateTo(new PageView(pageId));
    }

    long ticksOpen() {
        return ticksOpen;
    }
}
