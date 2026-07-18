#!/usr/bin/env python3
"""Integrity tests for the deterministic Gooby sticker-art pipeline."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "src/data/stickers/manifest.json"
MASTER_DIR = ROOT / "assets/stickers/masters"
RUNTIME_DIR = ROOT / "public/assets/stickers"
PROCESSOR = ROOT / "scripts/stickers/process.py"
LICENSE = "original first-party artwork generated for Gooby's Cozy Burrow"

EXPECTED_PAGES = {
    "home-life": (
        "sticker.care.first-pet",
        "sticker.care.first-feed",
        "sticker.care.first-bath",
        "sticker.care.full-night-sleep",
        "sticker.care.gentle-wake",
        "sticker.care.garden-harvest",
        "sticker.care.wardrobe-first-outfit",
        "sticker.care.decorated-room",
        "sticker.care.level-five",
    ),
    "city-days": (
        "sticker.city.first-trip",
        "sticker.city.all-shops",
        "sticker.city.smooth-driver",
        "sticker.city.market-day",
        "sticker.city.boutique-day",
        "sticker.city.salon-day",
        "sticker.city.first-return",
        "sticker.city.five-trips",
        "sticker.city.souvenir-spree",
    ),
    "game-medals": (
        "sticker.games.first-round",
        "sticker.games.new-best",
        "sticker.games.three-games",
        "sticker.games.six-games",
        "sticker.games.twelve-games",
        "sticker.games.all-games",
        "sticker.games.ten-rounds",
        "sticker.games.fifty-rounds",
        "sticker.games.hundred-rounds",
    ),
    "dreams-seasons": (
        "sticker.dreams.first-dream",
        "sticker.dreams.dream-week",
        "sticker.dreams.night-owl",
        "sticker.dreams.early-bird",
        "sticker.dreams.starry-night",
        "sticker.seasons.spring-bloom",
        "sticker.seasons.summer-sun",
        "sticker.seasons.autumn-leaf",
        "sticker.seasons.winter-frost",
    ),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def slug(sticker_id: str) -> str:
    return sticker_id.removeprefix("sticker.").replace(".", "-")


class StickerPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.records = cls.manifest["stickers"]
        cls.by_id = {record["id"]: record for record in cls.records}

    def test_contract_and_asset_bijection(self) -> None:
        expected_ids = tuple(
            sticker_id
            for page_ids in EXPECTED_PAGES.values()
            for sticker_id in page_ids
        )
        self.assertEqual(self.manifest["contract"]["pages"], list(EXPECTED_PAGES))
        self.assertEqual(self.manifest["contract"]["stickersPerPage"], 9)
        self.assertEqual(self.manifest["contract"]["stickerCount"], 36)
        self.assertEqual(len(self.records), 36)
        self.assertEqual(tuple(record["id"] for record in self.records), expected_ids)
        self.assertEqual(set(self.by_id), set(expected_ids))

        expected_master_names = {f"{slug(sticker_id)}.png" for sticker_id in expected_ids}
        expected_runtime_names = {f"{slug(sticker_id)}.webp" for sticker_id in expected_ids}
        self.assertEqual({path.name for path in MASTER_DIR.glob("*.png")}, expected_master_names)
        self.assertEqual({path.name for path in RUNTIME_DIR.glob("*.webp")}, expected_runtime_names)

        for page, page_ids in EXPECTED_PAGES.items():
            records = [record for record in self.records if record["page"] == page]
            self.assertEqual([record["slot"] for record in records], list(range(9)))
            self.assertEqual([record["id"] for record in records], list(page_ids))
            self.assertEqual(
                [record["sourceCell"] for record in records],
                [{"row": slot // 3, "column": slot % 3} for slot in range(9)],
            )

    def test_source_masters_and_hashes(self) -> None:
        self.assertEqual(self.manifest["license"], LICENSE)
        self.assertEqual(len(self.manifest["sourceSheets"]), 4)
        for source in self.manifest["sourceSheets"]:
            path = ROOT / source["path"]
            self.assertTrue(path.is_file())
            self.assertEqual(source["sha256"], sha256(path))
            self.assertEqual(source["bytes"], path.stat().st_size)
            self.assertEqual((source["width"], source["height"]), (1024, 1024))
            self.assertFalse(source["sourceAlphaDetected"])
            self.assertEqual(source["detectedGrid"]["columns"], 3)
            self.assertEqual(source["detectedGrid"]["rows"], 3)
            self.assertEqual(len(source["detectedGrid"]["xCuts"]), 2)
            self.assertEqual(len(source["detectedGrid"]["yCuts"]), 2)
            self.assertIn("checkerboard removed", source["alphaCorrection"])

        for record in self.records:
            self.assertEqual(record["review"]["goobyCharacter"], "approved")
            self.assertEqual(record["review"]["leftEar"], "upright")
            self.assertEqual(record["review"]["rightEar"], "lop")
            self.assertEqual(record["review"]["textLogoTrademark"], "none")
            self.assertEqual(record["review"]["crop"], "approved")
            for variant in ("master", "runtime"):
                asset = record[variant]
                path = ROOT / asset["path"]
                self.assertTrue(path.is_file())
                self.assertEqual(asset["sha256"], sha256(path))
                self.assertEqual(asset["bytes"], path.stat().st_size)

    def test_exactly_thirty_six_bilingual_alt_descriptions(self) -> None:
        en = [record["alt"]["en"] for record in self.records]
        de = [record["alt"]["de"] for record in self.records]
        self.assertEqual(len(en), 36)
        self.assertEqual(len(de), 36)
        self.assertTrue(all(isinstance(value, str) and value.strip() for value in en))
        self.assertTrue(all(isinstance(value, str) and value.strip() for value in de))
        self.assertEqual(len(set(en)), 36)
        self.assertEqual(len(set(de)), 36)

    def test_dimensions_transparency_margins_and_centering(self) -> None:
        for record in self.records:
            for variant, expected_size, expected_format, minimum_margin in (
                ("master", 512, "PNG", 20),
                ("runtime", 256, "WEBP", 10),
            ):
                asset = record[variant]
                with Image.open(ROOT / asset["path"]) as image:
                    self.assertEqual(image.format, expected_format)
                    self.assertEqual(image.size, (expected_size, expected_size))
                    rgba = np.asarray(image.convert("RGBA"))
                alpha = rgba[:, :, 3]
                self.assertEqual(int(alpha.min()), 0)
                self.assertEqual(int(alpha.max()), 255)
                self.assertTrue(np.all(alpha[[0, -1], :] == 0))
                self.assertTrue(np.all(alpha[:, [0, -1]] == 0))
                ys, xs = np.nonzero(alpha >= 8)
                self.assertGreater(xs.size, 0)
                margins = (
                    int(xs.min()),
                    int(ys.min()),
                    expected_size - 1 - int(xs.max()),
                    expected_size - 1 - int(ys.max()),
                )
                self.assertGreaterEqual(min(margins), minimum_margin)
                self.assertLessEqual(abs(margins[0] - margins[2]), 1)
                self.assertLessEqual(abs(margins[1] - margins[3]), 1)

    def test_runtime_budget(self) -> None:
        sizes = [record["runtime"]["bytes"] for record in self.records]
        self.assertTrue(all(size <= 40 * 1024 for size in sizes))
        self.assertEqual(sum(sizes), self.manifest["totalRuntimeBytes"])
        self.assertLessEqual(self.manifest["totalRuntimeBytes"], int(1.5 * 1024 * 1024))

    def test_processor_outputs_are_current(self) -> None:
        result = subprocess.run(
            [sys.executable, str(PROCESSOR), "--check"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=180,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("verified 36 stickers", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
