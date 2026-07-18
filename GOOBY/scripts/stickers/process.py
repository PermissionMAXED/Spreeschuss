#!/usr/bin/env python3
"""Deterministically build Gooby's 4x9 sticker art set from four source sheets."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "assets/stickers/sources"
MASTER_DIR = ROOT / "assets/stickers/masters"
RUNTIME_DIR = ROOT / "public/assets/stickers"
MANIFEST_PATH = ROOT / "src/data/stickers/manifest.json"
EXTERNAL_SOURCE_DIR = Path("/opt/cursor/artifacts/assets")

LICENSE = "original first-party artwork generated for Gooby's Cozy Burrow"
MASTER_SIZE = 512
RUNTIME_SIZE = 256
CONTENT_SIZE = 464
MAX_RUNTIME_BYTES = 40 * 1024
MAX_TOTAL_RUNTIME_BYTES = int(1.5 * 1024 * 1024)


@dataclass(frozen=True)
class StickerSpec:
    id: str
    alt_en: str
    alt_de: str

    @property
    def slug(self) -> str:
        return self.id.removeprefix("sticker.").replace(".", "-")


@dataclass(frozen=True)
class PageSpec:
    id: str
    source_name: str
    stickers: tuple[StickerSpec, ...]


PAGES = (
    PageSpec(
        "home-life",
        "gooby_stickers_home_life_sheet.png",
        (
            StickerSpec(
                "sticker.care.first-pet",
                "Gooby sits while a hand strokes its head, surrounded by hearts.",
                "Gooby sitzt, wird am Kopf gestreichelt und ist von Herzen umgeben.",
            ),
            StickerSpec(
                "sticker.care.first-feed",
                "Gooby sits and holds a large freshly picked carrot.",
                "Gooby sitzt da und hält eine große, frisch geerntete Karotte.",
            ),
            StickerSpec(
                "sticker.care.first-bath",
                "Gooby relaxes in a green bathtub overflowing with bubbles.",
                "Gooby entspannt in einer grünen Badewanne voller Schaumblasen.",
            ),
            StickerSpec(
                "sticker.care.full-night-sleep",
                "Gooby sleeps under a starry blanket on a crescent moon.",
                "Gooby schläft unter einer Sternendecke auf einer Mondsichel.",
            ),
            StickerSpec(
                "sticker.care.gentle-wake",
                "Gooby lies back as a hand gently rubs its belly.",
                "Gooby liegt auf dem Rücken und wird sanft am Bauch gestreichelt.",
            ),
            StickerSpec(
                "sticker.care.garden-harvest",
                "Gooby gardens in overalls beside a basket of carrots.",
                "Gooby gärtnert in einer Latzhose neben einem Korb voller Karotten.",
            ),
            StickerSpec(
                "sticker.care.wardrobe-first-outfit",
                "Gooby sits on a plaid rug and watches a tiny television.",
                "Gooby sitzt auf einem karierten Teppich und schaut einen kleinen Fernseher.",
            ),
            StickerSpec(
                "sticker.care.decorated-room",
                "Gooby sits at the entrance of a cozy room with a green sofa.",
                "Gooby sitzt am Eingang eines gemütlichen Zimmers mit grünem Sofa.",
            ),
            StickerSpec(
                "sticker.care.level-five",
                "Gooby stands beside a wooden nut grinder and a filled glass jar.",
                "Gooby steht neben einer hölzernen Nussmühle und einem gefüllten Glas.",
            ),
        ),
    ),
    PageSpec(
        "city-days",
        "gooby_stickers_city_days_sheet.png",
        (
            StickerSpec(
                "sticker.city.first-trip",
                "Gooby happily drives a small pink convertible.",
                "Gooby fährt fröhlich in einem kleinen rosa Cabrio.",
            ),
            StickerSpec(
                "sticker.city.all-shops",
                "Gooby stands proudly beside a mint green compact car.",
                "Gooby steht stolz neben einem mintgrünen Kleinwagen.",
            ),
            StickerSpec(
                "sticker.city.smooth-driver",
                "Gooby returns from shopping with four colorful bags.",
                "Gooby kommt mit vier bunten Einkaufstaschen vom Einkaufen zurück.",
            ),
            StickerSpec(
                "sticker.city.market-day",
                "Gooby looks through a striped shop window at toys and gifts.",
                "Gooby schaut durch ein gestreiftes Schaufenster auf Spielzeug und Geschenke.",
            ),
            StickerSpec(
                "sticker.city.boutique-day",
                "Gooby drives a yellow car through friendly city traffic.",
                "Gooby fährt in einem gelben Auto durch den freundlichen Stadtverkehr.",
            ),
            StickerSpec(
                "sticker.city.salon-day",
                "Gooby drives a blue car beneath a moonlit city sky.",
                "Gooby fährt in einem blauen Auto unter einem mondhellen Stadthimmel.",
            ),
            StickerSpec(
                "sticker.city.first-return",
                "Gooby wears a warm green hat, blue scarf, and yellow coat.",
                "Gooby trägt eine warme grüne Mütze, einen blauen Schal und eine gelbe Jacke.",
            ),
            StickerSpec(
                "sticker.city.five-trips",
                "Gooby pulls a green wagon carrying a wooden chair.",
                "Gooby zieht einen grünen Wagen mit einem Holzstuhl.",
            ),
            StickerSpec(
                "sticker.city.souvenir-spree",
                "Gooby studies a folded city map held in both paws.",
                "Gooby betrachtet einen gefalteten Stadtplan in beiden Pfoten.",
            ),
        ),
    ),
    PageSpec(
        "game-medals",
        "gooby_stickers_game_medals_sheet.png",
        (
            StickerSpec(
                "sticker.games.first-round",
                "Gooby plays at a cheerful wooden arcade cabinet.",
                "Gooby spielt an einem fröhlichen hölzernen Arcade-Automaten.",
            ),
            StickerSpec(
                "sticker.games.new-best",
                "Gooby jumps among colorful game tokens and sparkling prizes.",
                "Gooby springt zwischen bunten Spielmarken und funkelnden Preisen.",
            ),
            StickerSpec(
                "sticker.games.three-games",
                "Gooby cheers inside a ring of colorful arcade tokens.",
                "Gooby jubelt in einem Ring aus bunten Arcade-Spielmarken.",
            ),
            StickerSpec(
                "sticker.games.six-games",
                "Gooby wears a chef hat beside a tall strawberry cake.",
                "Gooby trägt eine Kochmütze neben einer hohen Erdbeertorte.",
            ),
            StickerSpec(
                "sticker.games.twelve-games",
                "Gooby rides a shopping cart with bright swooshing arrows.",
                "Gooby fährt in einem Einkaufswagen mit leuchtenden Schwungpfeilen.",
            ),
            StickerSpec(
                "sticker.games.all-games",
                "Gooby celebrates with raised paws among golden stars.",
                "Gooby feiert mit erhobenen Pfoten zwischen goldenen Sternen.",
            ),
            StickerSpec(
                "sticker.games.ten-rounds",
                "Gooby proudly holds a gold medal and star trophy.",
                "Gooby hält stolz eine Goldmedaille und einen Sternpokal.",
            ),
            StickerSpec(
                "sticker.games.fifty-rounds",
                "Gooby rests in a green chair with a controller and snacks.",
                "Gooby ruht in einem grünen Sessel mit Controller und Snacks.",
            ),
            StickerSpec(
                "sticker.games.hundred-rounds",
                "Gooby crosses a finish ribbon as colorful confetti falls.",
                "Gooby durchquert ein Zielband, während buntes Konfetti fällt.",
            ),
        ),
    ),
    PageSpec(
        "dreams-seasons",
        "gooby_stickers_dreams_seasons_sheet.png",
        (
            StickerSpec(
                "sticker.dreams.first-dream",
                "Gooby sits in a spring garden of tulips and butterflies.",
                "Gooby sitzt in einem Frühlingsgarten mit Tulpen und Schmetterlingen.",
            ),
            StickerSpec(
                "sticker.dreams.dream-week",
                "Gooby splashes in a blue pool beside a yellow duck.",
                "Gooby planscht in einem blauen Becken neben einer gelben Ente.",
            ),
            StickerSpec(
                "sticker.dreams.night-owl",
                "Gooby wears a plaid scarf among swirling autumn leaves.",
                "Gooby trägt einen karierten Schal zwischen wirbelnden Herbstblättern.",
            ),
            StickerSpec(
                "sticker.dreams.early-bird",
                "Gooby bundles up in a snowy forest with a red hat and scarf.",
                "Gooby sitzt warm eingepackt mit roter Mütze und Schal im Schneewald.",
            ),
            StickerSpec(
                "sticker.dreams.starry-night",
                "Gooby looks through a telescope beneath a starry night sky.",
                "Gooby schaut unter einem sternklaren Nachthimmel durch ein Teleskop.",
            ),
            StickerSpec(
                "sticker.seasons.spring-bloom",
                "Gooby shelters under a green leaf umbrella in spring rain.",
                "Gooby schützt sich im Frühlingsregen unter einem grünen Blattschirm.",
            ),
            StickerSpec(
                "sticker.seasons.summer-sun",
                "Gooby carries a pink birthday cake with one glowing candle.",
                "Gooby trägt eine rosa Geburtstagstorte mit einer leuchtenden Kerze.",
            ),
            StickerSpec(
                "sticker.seasons.autumn-leaf",
                "Gooby rests on a purple cloud beneath a golden crescent moon.",
                "Gooby ruht auf einer lila Wolke unter einer goldenen Mondsichel.",
            ),
            StickerSpec(
                "sticker.seasons.winter-frost",
                "A shiny golden Gooby statue stands on a round pedestal.",
                "Eine glänzende goldene Gooby-Statue steht auf einem runden Sockel.",
            ),
        ),
    ),
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def source_path(page: PageSpec) -> Path:
    destination = SOURCE_DIR / page.source_name
    if not destination.exists():
        original = EXTERNAL_SOURCE_DIR / page.source_name
        if not original.is_file():
            raise FileNotFoundError(
                f"Missing first-party source sheet {destination}; bootstrap input {original} is unavailable"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, destination)
    return destination


def detect_checker_period(rgb: np.ndarray) -> int:
    """Find the repeating baked checker period from neutral background pixels."""
    channel_range = np.ptp(rgb.astype(np.int16), axis=2)
    neutral = (channel_range <= 9) & (rgb.min(axis=2) >= 220)
    luminance = rgb.astype(np.int16).mean(axis=2)
    scores: list[tuple[float, int]] = []
    for period in range(30, 50):
        valid = neutral[:, :-period] & neutral[:, period:]
        differences = np.abs(luminance[:, :-period] - luminance[:, period:])[valid]
        if differences.size < 10_000:
            continue
        scores.append((float(np.mean(differences)), period))
    if not scores:
        raise ValueError("Could not detect the source sheet checkerboard")
    return min(scores)[1]


def checker_reference(rgb: np.ndarray, period: int) -> np.ndarray:
    """Build a robust RGB reference for each checker phase."""
    height, width, _ = rgb.shape
    neutral = (np.ptp(rgb.astype(np.int16), axis=2) <= 9) & (rgb.min(axis=2) >= 220)
    phase = np.empty((period, period, 3), dtype=np.uint8)
    for phase_y in range(period):
        for phase_x in range(period):
            samples = rgb[phase_y:height:period, phase_x:width:period]
            valid = neutral[phase_y:height:period, phase_x:width:period]
            values = samples[valid]
            if values.size == 0:
                phase[phase_y, phase_x] = (245, 245, 245)
            else:
                phase[phase_y, phase_x] = np.median(values, axis=0).astype(np.uint8)
    y_phase = np.arange(height) % period
    x_phase = np.arange(width) % period
    return phase[y_phase[:, None], x_phase[None, :]]


def foreground_seed(rgb: np.ndarray, _reference: np.ndarray) -> np.ndarray:
    """Separate colored/dark artwork from the sheet's neutral light checker."""
    signed = rgb.astype(np.int16)
    chroma = np.ptp(signed, axis=2)
    colored = chroma >= 11
    near_colored = np.asarray(
        Image.fromarray((colored * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(11))
    ) >= 128
    dark_detail = rgb.min(axis=2) <= 218
    return colored | (dark_detail & near_colored)


def axis_cuts(seed: np.ndarray, axis: int) -> tuple[int, int]:
    density = seed.sum(axis=axis)
    length = density.shape[0]
    cuts: list[int] = []
    for fraction in (1 / 3, 2 / 3):
        expected = round(length * fraction)
        candidates = range(expected - 8, expected + 9)
        scored = []
        for candidate in candidates:
            start = max(0, candidate - 4)
            end = min(length, candidate + 5)
            scored.append((int(density[start:end].sum()), abs(candidate - expected), candidate))
        cuts.append(min(scored)[2])
    return cuts[0], cuts[1]


def remove_small_components(mask: np.ndarray, minimum: int = 24) -> np.ndarray:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    cleaned = np.zeros_like(mask, dtype=bool)
    for start_y, start_x in zip(*np.nonzero(mask & ~visited), strict=True):
        if visited[start_y, start_x]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and mask[next_y, next_x]
                    and not visited[next_y, next_x]
                ):
                    visited[next_y, next_x] = True
                    queue.append((next_y, next_x))
        if len(component) >= minimum:
            ys, xs = zip(*component, strict=True)
            cleaned[np.asarray(ys), np.asarray(xs)] = True
    return cleaned


def split_sticker_masks(seed: np.ndarray) -> tuple[np.ndarray, ...]:
    """Assign disconnected artwork pieces to the nearest of nine main stickers."""
    height, width = seed.shape
    visited = np.zeros_like(seed, dtype=bool)
    components: list[tuple[list[tuple[int, int]], float, float]] = []
    for start_y, start_x in zip(*np.nonzero(seed & ~visited), strict=True):
        if visited[start_y, start_x]:
            continue
        queue: deque[tuple[int, int]] = deque([(int(start_y), int(start_x))])
        visited[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if (
                    0 <= next_y < height
                    and 0 <= next_x < width
                    and seed[next_y, next_x]
                    and not visited[next_y, next_x]
                ):
                    visited[next_y, next_x] = True
                    queue.append((next_y, next_x))
        if len(component) >= 24:
            center_y = sum(point[0] for point in component) / len(component)
            center_x = sum(point[1] for point in component) / len(component)
            components.append((component, center_y, center_x))

    anchors: list[tuple[float, float]] = []
    for row in range(3):
        for column in range(3):
            candidates = [
                item
                for item in components
                if int(item[1] * 3 / height) == row and int(item[2] * 3 / width) == column
            ]
            if not candidates:
                raise ValueError(f"No primary artwork component in source cell {row},{column}")
            primary = max(candidates, key=lambda item: len(item[0]))
            anchors.append((primary[1], primary[2]))

    masks = [np.zeros_like(seed, dtype=bool) for _ in range(9)]
    for component, center_y, center_x in components:
        slot = min(
            range(9),
            key=lambda index: (
                ((center_y - anchors[index][0]) / height) ** 2
                + ((center_x - anchors[index][1]) / width) ** 2
            ),
        )
        ys, xs = zip(*component, strict=True)
        masks[slot][np.asarray(ys), np.asarray(xs)] = True
    return tuple(masks)


def fill_holes(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    exterior = np.zeros_like(mask, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        if not mask[0, x]:
            exterior[0, x] = True
            queue.append((0, x))
        if not mask[height - 1, x]:
            exterior[height - 1, x] = True
            queue.append((height - 1, x))
    for y in range(height):
        if not mask[y, 0] and not exterior[y, 0]:
            exterior[y, 0] = True
            queue.append((y, 0))
        if not mask[y, width - 1] and not exterior[y, width - 1]:
            exterior[y, width - 1] = True
            queue.append((y, width - 1))
    while queue:
        y, x = queue.popleft()
        for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if (
                0 <= next_y < height
                and 0 <= next_x < width
                and not mask[next_y, next_x]
                and not exterior[next_y, next_x]
            ):
                exterior[next_y, next_x] = True
                queue.append((next_y, next_x))
    return mask | (~mask & ~exterior)


def reconstruct_sticker(
    rgb: np.ndarray,
    assigned_seed: np.ndarray,
) -> Image.Image:
    source_y, source_x = np.nonzero(assigned_seed)
    if source_x.size == 0:
        raise ValueError("No sticker foreground assigned")
    source_padding = 2
    left = max(0, int(source_x.min()) - source_padding)
    top = max(0, int(source_y.min()) - source_padding)
    right = min(rgb.shape[1], int(source_x.max()) + source_padding + 1)
    bottom = min(rgb.shape[0], int(source_y.max()) + source_padding + 1)
    cell_rgb = rgb[top:bottom, left:right].copy()
    cell_seed = assigned_seed[top:bottom, left:right]
    if not cell_seed.any():
        raise ValueError("No sticker foreground detected in assigned crop")

    padding = 10
    cell_seed = np.pad(cell_seed, padding, constant_values=False)
    cell_rgb = np.pad(
        cell_rgb,
        ((padding, padding), (padding, padding), (0, 0)),
        constant_values=255,
    )
    mask_image = Image.fromarray((cell_seed * 255).astype(np.uint8), "L")
    expanded = mask_image.filter(ImageFilter.MaxFilter(13))
    closed = expanded.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    silhouette = fill_holes(np.asarray(closed) >= 128)
    silhouette = remove_small_components(silhouette, minimum=80)

    ys, xs = np.nonzero(silhouette)
    if xs.size == 0:
        raise ValueError("Empty reconstructed sticker silhouette")
    neutral_light = (
        (np.ptp(cell_rgb.astype(np.int16), axis=2) <= 10)
        & (cell_rgb.min(axis=2) >= 218)
    )
    added_outline = silhouette & ~cell_seed
    clean_white = silhouette & (neutral_light | added_outline)
    cell_rgb[clean_white] = (255, 255, 255)

    alpha = Image.fromarray((silhouette * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(0.65)
    )
    rgba = Image.fromarray(cell_rgb, "RGB").convert("RGBA")
    rgba.putalpha(alpha)
    alpha_array = np.asarray(alpha)
    crop_y, crop_x = np.nonzero(alpha_array >= 2)
    crop_box = (
        int(crop_x.min()),
        int(crop_y.min()),
        int(crop_x.max()) + 1,
        int(crop_y.max()) + 1,
    )
    return rgba.crop(crop_box)


def center_master(sticker: Image.Image) -> Image.Image:
    width, height = sticker.size
    scale = min(CONTENT_SIZE / width, CONTENT_SIZE / height)
    output_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    resized = sticker.resize(output_size, Image.Resampling.LANCZOS)
    master = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (255, 255, 255, 0))
    offset = ((MASTER_SIZE - output_size[0]) // 2, (MASTER_SIZE - output_size[1]) // 2)
    master.alpha_composite(resized, offset)
    return master


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def webp_bytes(image: Image.Image) -> tuple[bytes, int]:
    runtime = image.resize((RUNTIME_SIZE, RUNTIME_SIZE), Image.Resampling.LANCZOS)
    for quality in range(82, 23, -2):
        output = io.BytesIO()
        runtime.save(
            output,
            format="WEBP",
            quality=quality,
            method=6,
            exact=True,
            alpha_quality=100,
        )
        data = output.getvalue()
        if len(data) <= MAX_RUNTIME_BYTES:
            return data, quality
    raise ValueError("Could not encode runtime sticker beneath the 40 KiB limit")


def file_record(path: Path, data: bytes, size: int, format_name: str) -> dict[str, Any]:
    return {
        "path": relative(path),
        "sha256": sha256_bytes(data),
        "bytes": len(data),
        "width": size,
        "height": size,
        "format": format_name,
    }


def write_or_check(path: Path, data: bytes, check: bool) -> None:
    if check:
        try:
            current = path.read_bytes()
        except FileNotFoundError as error:
            raise ValueError(f"{relative(path)} is missing; run the processor") from error
        if current != data:
            raise ValueError(f"{relative(path)} is stale; run the processor")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def process(check: bool) -> dict[str, Any]:
    sticker_records: list[dict[str, Any]] = []
    sheet_records: list[dict[str, Any]] = []
    total_runtime_bytes = 0

    for page in PAGES:
        sheet_path = source_path(page)
        source_data = sheet_path.read_bytes()
        source_image = Image.open(io.BytesIO(source_data))
        had_alpha = "A" in source_image.getbands()
        rgb_image = source_image.convert("RGB")
        rgb = np.asarray(rgb_image)
        period = detect_checker_period(rgb)
        reference = checker_reference(rgb, period)
        seed = foreground_seed(rgb, reference)
        sticker_masks = split_sticker_masks(seed)
        x_cuts = axis_cuts(seed, axis=0)
        y_cuts = axis_cuts(seed, axis=1)

        sheet_records.append(
            {
                "page": page.id,
                "path": relative(sheet_path),
                "sha256": sha256_bytes(source_data),
                "bytes": len(source_data),
                "width": source_image.width,
                "height": source_image.height,
                "sourceAlphaDetected": had_alpha,
                "detectedGrid": {
                    "columns": 3,
                    "rows": 3,
                    "xCuts": list(x_cuts),
                    "yCuts": list(y_cuts),
                    "checkerPeriod": period,
                },
                "alphaCorrection": (
                    "none"
                    if had_alpha
                    else "baked checkerboard removed with phase sampling and silhouette reconstruction"
                ),
            }
        )

        for slot, sticker in enumerate(page.stickers):
            row, column = divmod(slot, 3)
            reconstructed = reconstruct_sticker(rgb, sticker_masks[slot])
            master = center_master(reconstructed)
            master_data = png_bytes(master)
            runtime_data, quality = webp_bytes(master)
            master_path = MASTER_DIR / f"{sticker.slug}.png"
            runtime_path = RUNTIME_DIR / f"{sticker.slug}.webp"
            write_or_check(master_path, master_data, check)
            write_or_check(runtime_path, runtime_data, check)
            total_runtime_bytes += len(runtime_data)
            sticker_records.append(
                {
                    "id": sticker.id,
                    "page": page.id,
                    "slot": slot,
                    "sourceCell": {"row": row, "column": column},
                    "master": file_record(master_path, master_data, MASTER_SIZE, "png"),
                    "runtime": {
                        **file_record(runtime_path, runtime_data, RUNTIME_SIZE, "webp"),
                        "quality": quality,
                    },
                    "alt": {"en": sticker.alt_en, "de": sticker.alt_de},
                    "review": {
                        "goobyCharacter": "approved",
                        "leftEar": "upright",
                        "rightEar": "lop",
                        "textLogoTrademark": "none",
                        "crop": "approved",
                    },
                }
            )

    if total_runtime_bytes > MAX_TOTAL_RUNTIME_BYTES:
        raise ValueError(
            f"Runtime stickers use {total_runtime_bytes} bytes, above {MAX_TOTAL_RUNTIME_BYTES}"
        )

    manifest = {
        "schemaVersion": 1,
        "license": LICENSE,
        "generator": "scripts/stickers/process.py",
        "contract": {
            "pages": [page.id for page in PAGES],
            "stickersPerPage": 9,
            "stickerCount": 36,
        },
        "constraints": {
            "masterSize": MASTER_SIZE,
            "runtimeSize": RUNTIME_SIZE,
            "maxRuntimeFileBytes": MAX_RUNTIME_BYTES,
            "maxTotalRuntimeBytes": MAX_TOTAL_RUNTIME_BYTES,
        },
        "sourceSheets": sheet_records,
        "stickers": sticker_records,
        "totalRuntimeBytes": total_runtime_bytes,
    }
    manifest_data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    write_or_check(MANIFEST_PATH, manifest_data, check)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="rebuild in memory and fail if any committed output differs",
    )
    arguments = parser.parse_args()
    manifest = process(arguments.check)
    action = "verified" if arguments.check else "wrote"
    print(
        f"Sticker processor {action} {len(manifest['stickers'])} stickers; "
        f"runtime total {manifest['totalRuntimeBytes']} bytes."
    )


if __name__ == "__main__":
    main()
