package dev.cuprum.cuprum.client.handbook;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.handbook.HandbookBookmarksCore;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.resources.ResourceLocation;

/**
 * Client-local bookmark persistence (handbook-config.md §4): never synced, stored in
 * {@code <configDir>/cuprum/handbook_bookmarks.json}, keyed per world/server id, capped at
 * {@link HandbookBookmarksCore#MAX_BOOKMARKS}. A corrupt file is renamed {@code .corrupt}
 * and reset — never a crash (the list semantics live in the MC-free
 * {@link HandbookBookmarksCore}, pinned by JUnit). All access is client-thread only (screen
 * interactions); IO failures degrade to in-memory state with one WARN.
 *
 * <p>File shape: {@code {"version": 1, "worlds": {"<key>": ["cuprum:diagnostics/...", ...]}}}.
 */
public final class HandbookBookmarks {
    static final String FILE_NAME = "handbook_bookmarks.json";
    private static final int FILE_VERSION = 1;

    /** In-memory store: world key → sanitized bookmark id list (insertion-ordered). */
    private static Map<String, List<String>> worlds;

    private HandbookBookmarks() {
    }

    /** The active world/server key: distinct singleplayer worlds and servers never mix rails. */
    public static String worldKey(Minecraft minecraft) {
        if (minecraft.getSingleplayerServer() != null) {
            return "sp:" + minecraft.getSingleplayerServer().getWorldData().getLevelName();
        }
        ServerData server = minecraft.getCurrentServer();
        return server != null ? "mp:" + server.ip : "unknown";
    }

    /** The current world's bookmarks in insertion order (loads the file on first use). */
    public static List<ResourceLocation> bookmarks(String worldKey) {
        List<String> raw = store().getOrDefault(worldKey, List.of());
        List<ResourceLocation> ids = new ArrayList<>(raw.size());
        for (String entry : raw) {
            ResourceLocation id = ResourceLocation.tryParse(entry);
            if (id != null) {
                ids.add(id);
            }
        }
        return List.copyOf(ids);
    }

    public static boolean isBookmarked(String worldKey, ResourceLocation pageId) {
        return store().getOrDefault(worldKey, List.of()).contains(pageId.toString());
    }

    /** Star toggle: flips the page in the world's rail (refused silently at the cap) + saves. */
    public static void toggle(String worldKey, ResourceLocation pageId) {
        Map<String, List<String>> current = store();
        List<String> next = HandbookBookmarksCore.toggle(
                current.getOrDefault(worldKey, List.of()), pageId.toString());
        if (next.isEmpty()) {
            current.remove(worldKey);
        } else {
            current.put(worldKey, next);
        }
        save();
    }

    /** Test hook + reload point: drops the in-memory store so the next read re-parses the file. */
    public static void invalidate() {
        worlds = null;
    }

    public static Path filePath() {
        return FabricLoader.getInstance().getConfigDir().resolve("cuprum").resolve(FILE_NAME);
    }

    private static Map<String, List<String>> store() {
        if (worlds == null) {
            worlds = load();
        }
        return worlds;
    }

    private static Map<String, List<String>> load() {
        Path path = filePath();
        if (!Files.isRegularFile(path)) {
            return new TreeMap<>();
        }
        try {
            String text = Files.readString(path, StandardCharsets.UTF_8);
            JsonObject root = JsonParser.parseString(text).getAsJsonObject();
            JsonObject worldsJson = root.getAsJsonObject("worlds");
            Map<String, List<String>> out = new TreeMap<>();
            if (worldsJson != null) {
                for (Map.Entry<String, JsonElement> entry : worldsJson.entrySet()) {
                    List<String> ids = new ArrayList<>();
                    for (JsonElement element : entry.getValue().getAsJsonArray()) {
                        ids.add(element.getAsString());
                    }
                    List<String> sane = HandbookBookmarksCore.sanitize(ids);
                    if (!sane.isEmpty()) {
                        out.put(entry.getKey(), sane);
                    }
                }
            }
            return out;
        } catch (Exception e) {
            quarantineCorruptFile(path, e);
            return new TreeMap<>();
        }
    }

    private static void quarantineCorruptFile(Path path, Exception cause) {
        Cuprum.LOGGER.warn("[handbook] bookmarks file {} is corrupt; renaming to .corrupt and resetting",
                path, cause);
        try {
            Files.move(path, path.resolveSibling(FILE_NAME + ".corrupt"), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException moveFailure) {
            Cuprum.LOGGER.warn("[handbook] could not quarantine corrupt bookmarks file", moveFailure);
        }
    }

    private static void save() {
        JsonObject worldsJson = new JsonObject();
        store().forEach((key, ids) -> {
            JsonArray array = new JsonArray();
            ids.forEach(array::add);
            worldsJson.add(key, array);
        });
        JsonObject root = new JsonObject();
        root.addProperty("version", FILE_VERSION);
        root.add("worlds", worldsJson);
        Path path = filePath();
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, root.toString(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Cuprum.LOGGER.warn("[handbook] could not save bookmarks to {}; keeping in-memory state", path, e);
        }
    }
}
