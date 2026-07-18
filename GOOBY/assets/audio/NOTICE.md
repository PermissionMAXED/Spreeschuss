## Audio

Runtime audio is local and file-backed. Source archives/files, genuine license notices, selected archive entries, input/output SHA-256 hashes, transforms, and measured loudness are recorded in `assets/audio/sources.lock.json` and `assets/audio/build-report.json`.

### Kenney sound effects

The curated UI, gameplay, reward, and vehicle cues are adapted from the following genuine Kenney packs. Each archive’s included `License.txt` releases the content under **Creative Commons Zero 1.0 Universal (CC0 1.0)**; attribution is not required.

| Pack | Author | Official source | Archive SHA-256 | Genuine `License.txt` SHA-256 |
| --- | --- | --- | --- | --- |
| Interface Sounds | Kenney | https://kenney.nl/assets/interface-sounds | `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232` | `f7966c773bbed0eca6a9c75081c44a178b38eae112724dbb5fdfbd4192d118a9` |
| UI Audio | Kenney Vleugels | https://kenney.nl/assets/ui-audio | `946fc23a63d535d693eb31b2eabb80c8c28d6351e2186b344ceb71b2cb1d5eb6` | `4f88ab3c885c87874834441a0d009cea8942f57461d7b870be65cf4e31362073` |
| Impact Sounds | Kenney | https://kenney.nl/assets/impact-sounds | `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8` | `b49aa9c56b04528b95913de13e506a0f7c5e807b9925db9bfef86af1f91120db` |
| Music Jingles | Kenney Vleugels | https://kenney.nl/assets/music-jingles | `b729ba57959bd58793d2c5cafa348aaf2655d354f3da35ec4729e03ec77197b8` | `373b1c880ee6c7a83c1ccf209f251cf45fc9ea9b1f0330844fa7be64a401adc4` |

License: https://creativecommons.org/publicdomain/zero/1.0/

The selected OGG entries were converted to 44.1 kHz mono PCM WAV and loudness/true-peak normalized for in-game playback. Exact entry-to-file bindings are in `assets/audio/build-report.json`.

### Zone music

All eight zone tracks are authored by **Yanni Ziangos (YannZ)** and come from **Indie Meditations (Minimalist & Cozy Vibes) FREE Music Pack**:

- Source: https://opengameart.org/content/indie-meditations-free-music-pack
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
- License text: https://creativecommons.org/licenses/by/4.0/ (verbatim copy SHA-256 `6fded7d2dc6a3f3100d106ec5c4991ee926df701a36e68565ff4fbceabd0f2f2`)
- Modification: each authored, seamless-loop OGG was converted to normalized 44.1 kHz AAC-LC M4A for Gooby’s Cozy Burrow; no composition was generated or replaced procedurally.

| Zone | Exact track title | Author | Runtime file |
| --- | --- | --- | --- |
| home | lvl 2 – the village | Yanni Ziangos (YannZ) | `assets/audio/music/home.m4a` |
| city | lvl 7 – the raft on the ocean | Yanni Ziangos (YannZ) | `assets/audio/music/city.m4a` |
| shop | lvl 1 – the royal palace | Yanni Ziangos (YannZ) | `assets/audio/music/shop.m4a` |
| calm | lvl 5 – the oasis or resting place | Yanni Ziangos (YannZ) | `assets/audio/music/calm.m4a` |
| action | lvl 9 – the volcanic ascent | Yanni Ziangos (YannZ) | `assets/audio/music/action.m4a` |
| lullaby | lvl 0 – the tutorial | Yanni Ziangos (YannZ) | `assets/audio/music/lullaby.m4a` |
| surf | lvl 6 – the beach | Yanni Ziangos (YannZ) | `assets/audio/music/surf.m4a` |
| cake | lvl 3 – the grassland | Yanni Ziangos (YannZ) | `assets/audio/music/cake.m4a` |

Required attribution:

> Music by Yanni Ziangos a.k.a. YannZ — https://yannz.itch.io — licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). Source: https://opengameart.org/content/indie-meditations-free-music-pack. Modified for Gooby’s Cozy Burrow by converting the original OGG tracks to normalized AAC-LC M4A.

### Original Gooby nonverbal voice cues

Original nonverbal Gooby synth recipes: `happy.wav`, `giggle.wav`, `curious.wav`, `sleepy.wav`, and `sad.wav` are original first-party nonverbal sound designs rendered offline from the existing recipes in `src/audio/synth-bank.ts` (source SHA-256 `de1685bd28795bb2c66878e3abe90860e7b25d1cc12fd9c844c75950038cd8de`). They contain no third-party or unverifiable voice recording.
