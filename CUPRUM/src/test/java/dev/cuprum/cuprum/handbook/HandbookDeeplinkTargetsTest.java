package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/**
 * {@code handbook_deeplink_targets} (handbook-config.md §10, plan D9): pins the
 * {@code HandbookTopics} page-id literals against the committed page JSONs without Minecraft
 * classes — the string literals here MUST mirror {@code dev.cuprum.cuprum.api.handbook
 * .HandbookTopics} exactly (that class carries {@code ResourceLocation}s, which are barred
 * from this source set). The runtime half — every constant resolves in the LOADED store — is
 * asserted by the {@code handbook_pages_valid} server GameTest. Objective: dangling = 0.
 */
final class HandbookDeeplinkTargetsTest {
    /** Mirror of {@code HandbookTopics}: one literal per constant, append-only. */
    private static final List<String> TOPICS = List.of(
            "cuprum:diagnostics/charge_probe",
            "cuprum:diagnostics/diagnostic_coil",
            "cuprum:diagnostics/fx_probe");

    @Test
    void everyTopicConstantHasACommittedPage() throws IOException {
        Map<String, com.google.gson.JsonObject> pages = HandbookJsonFixture.loadAll("pages");
        for (String topic : TOPICS) {
            String relative = topic.substring("cuprum:".length());
            assertTrue(pages.containsKey(relative),
                    "HandbookTopics constant " + topic + " has no committed page JSON");
            assertEquals(topic, pages.get(relative).get("id").getAsString(),
                    "committed page id must equal the deep-link literal");
        }
    }

    @Test
    void topicListCoversEveryCommittedPage() throws IOException {
        // W1-exact: three committed pages, three constants; future waves may ship pages
        // without constants, but constants may never dangle (asymmetric by design).
        TreeSet<String> pageIds = new TreeSet<>();
        for (Map.Entry<String, com.google.gson.JsonObject> entry
                : HandbookJsonFixture.loadAll("pages").entrySet()) {
            pageIds.add(entry.getValue().get("id").getAsString());
        }
        assertEquals(new TreeSet<>(TOPICS), pageIds,
                "W1 topic constants and committed pages must agree 1:1 (plan D6)");
    }

    @Test
    void topicsAreUniqueAndWellFormed() {
        TreeSet<String> unique = new TreeSet<>(TOPICS);
        assertEquals(TOPICS.size(), unique.size(), "duplicate HandbookTopics literals");
        for (String topic : TOPICS) {
            assertTrue(topic.matches("cuprum:[a-z0-9_]+/[a-z0-9_]+"),
                    "topic " + topic + " must be a cuprum:<category>/<page> id");
        }
    }
}
