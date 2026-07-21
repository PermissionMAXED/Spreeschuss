#version 330

// Cuprum FX Ripple, vertex stage. Copyright 2026 Cuprum contributors, MIT.
// Original POSITION_COLOR_TEX transform: UV0 carries (signed band coordinate, normalized life).
// Authorship/derivation record: docs/shader-research/W1D_FX_RIPPLE_PROVENANCE.md.

#moj_import <minecraft:fog.glsl>
#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;

out vec2 cuprumBandLife;
out vec2 cuprumFogDistance;
out vec4 cuprumBaseColor;

void main() {
    vec4 cameraSpacePosition = ModelViewMat * vec4(Position, 1.0);
    gl_Position = ProjMat * cameraSpacePosition;

    cuprumBandLife = UV0;
    cuprumFogDistance = vec2(
        fog_spherical_distance(Position),
        fog_cylindrical_distance(Position)
    );
    cuprumBaseColor = Color;
}
