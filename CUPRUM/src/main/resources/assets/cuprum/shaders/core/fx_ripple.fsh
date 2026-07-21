#version 330

// Cuprum FX Ripple, fragment stage. Copyright 2026 Cuprum contributors, MIT.
// Original quartic ring profile and life-driven copper tint/fade.
// Authorship/derivation record: docs/shader-research/W1D_FX_RIPPLE_PROVENANCE.md.

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>

in vec2 cuprumBandLife;
in vec2 cuprumFogDistance;
in vec4 cuprumBaseColor;

out vec4 fragColor;

void main() {
    float bandCoordinate = clamp(cuprumBandLife.x, -1.0, 1.0);
    float bandSquared = bandCoordinate * bandCoordinate;
    float bandQuartic = bandSquared * bandSquared;
    float bandFalloff = max(0.0, 1.0 - bandQuartic);

    float life = clamp(cuprumBandLife.y, 0.0, 1.0);
    float lifeRemaining = 1.0 - life;
    float lifeFade = lifeRemaining * lifeRemaining * (0.35 + 0.65 * lifeRemaining);
    float lateLife = life * life;
    vec3 ignitionTint = vec3(0.16, 0.07, 0.01) * lifeRemaining * lifeRemaining;
    vec3 coolingTint = vec3(-0.06, 0.015, 0.035) * lateLife;
    vec3 lifeTintedColor = max(vec3(0.0), cuprumBaseColor.rgb + ignitionTint + coolingTint);

    float fogVisibility = 1.0 - total_fog_value(
        cuprumFogDistance.x, cuprumFogDistance.y,
        FogEnvironmentalStart, FogEnvironmentalEnd,
        FogRenderDistanceStart, FogRenderDistanceEnd);
    float opacity = cuprumBaseColor.a * ColorModulator.a * bandFalloff * lifeFade * fogVisibility;
    fragColor = vec4(lifeTintedColor * ColorModulator.rgb * fogVisibility, opacity);
}
