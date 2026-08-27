package com.gatecrash.property.dto;

import com.gatecrash.property.PropertyNodeKind;
import com.gatecrash.property.PropertyType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class PropertyDtos {

    private PropertyDtos() {
    }

    // ----- levels (the shape of the tree) ---------------------------------------------------

    public record LevelSpec(
            @NotNull PropertyNodeKind kind,
            @NotBlank @Size(max = 40) String singular,
            @NotBlank @Size(max = 40) String plural) {
    }

    /**
     * Replaces a township's entire level set. Whole-set rather than per-level because the levels
     * are ordered and contiguous: inserting a Floor level between Tower and Flat re-depths every
     * node beneath it, and expressing that as a sequence of independent edits invites a caller to
     * stop halfway and leave the tree describing a shape it no longer has.
     */
    public record DefineLevelsRequest(
            @NotEmpty @Size(max = 6) @Valid List<LevelSpec> levels) {
    }

    public record PropertyLevelResponse(
            UUID id, int depth, PropertyNodeKind kind, String singular, String plural,
            long nodeCount) {
    }

    /** Everything the console needs to render a township's structure tab set. */
    public record PropertyProfileResponse(
            PropertyType propertyType,
            String propertyTypeLabel,
            boolean hasFloors,
            List<PropertyLevelResponse> levels) {
    }

    /**
     * One entry in the project-type catalogue a super admin picks from at onboarding.
     *
     * <p>Carries the level set it would seed, so the console can show the resulting structure
     * *before* the township is created -- picking "Mall / retail centre" and seeing
     * "Mall -> Level -> Shop" is what tells a super admin whether it is the right choice, and the
     * level set is the one thing that cannot be reshaped later.
     */
    public record PropertyTypeOption(
            PropertyType value,
            String label,
            /** Which group the picker files it under: Residential, Commercial, Mixed use. */
            String category,
            String categoryLabel,
            String description,
            boolean hasFloors,
            List<LevelSpec> defaultLevels) {
    }

    public record SetPropertyTypeRequest(
            @NotNull PropertyType propertyType,
            /** Re-seed the level labels from the type's preset. Refused if any node exists. */
            boolean resetLevels) {
    }

    // ----- nodes (the tree itself) -----------------------------------------------------------

    public record CreateNodeRequest(
            /** Null creates a root. */
            UUID parentId,
            @NotBlank @Size(max = 80) String name,
            /** Required at the unit level, rejected elsewhere. */
            @Size(max = 40) String code,
            /** Required at a floor level, rejected elsewhere. */
            @Min(-10) @Max(200) Integer levelNumber,
            @Min(0) @Max(64) Integer declaredOccupancy) {
    }

    public record UpdateNodeRequest(
            @NotBlank @Size(max = 80) String name,
            @Size(max = 40) String code,
            @Min(-10) @Max(200) Integer levelNumber) {
    }

    public record SetOccupancyRequest(
            @NotNull @Min(0) @Max(64) Integer declaredOccupancy) {
    }

    public record PropertyNodeResponse(
            UUID id,
            UUID parentId,
            int depth,
            PropertyNodeKind kind,
            String name,
            String code,
            Integer levelNumber,
            /**
             * The building or grouping this node sits in — "Tower A", "Rose Cluster". Floors are
             * walked past: in a Tower -> Floor -> Flat project a flat's immediate parent is the
             * storey, and "14" is not a useful answer to "which building?". Null for a root.
             *
             * <p>Served here rather than derived on the client so that the three screens which group
             * units by their building (provisioning, audience builder, visit filter) do not each
             * have to walk the tree — and do not each get it subtly different.
             */
            String containerName,
            /** Declared headcount; always 0 on anything that is not a unit. */
            int declaredOccupancy,
            /** Active resident accounts attached to this unit; 0 elsewhere. */
            long residentAccounts,
            long childCount,
            OffsetDateTime createdAt) {
    }

    // ----- bulk creation ---------------------------------------------------------------------

    /**
     * Generates a building's worth of structure in one call, because creating a 20-storey tower
     * four units at a time is 80 requests and the reason bulk-flats existed already.
     *
     * <p>{@code codePattern} accepts {@code {building}}, {@code {floor}} and {@code {unit}}:
     * {@code "A-{floor}{unit}"} over floors 1-3 and 2 units per floor mints A-101, A-102, A-201...
     */
    public record BulkCreateRequest(
            @NotNull UUID buildingId,
            /** Omitted entirely for a project with no floor level. */
            @Min(-10) @Max(200) Integer fromFloor,
            @Min(-10) @Max(200) Integer toFloor,
            @NotNull @Min(1) @Max(50) Integer unitsPerFloor,
            @NotBlank @Size(max = 60) String codePattern,
            /** Width to zero-pad {@code {unit}} to; 2 gives 01, 02. */
            @Min(1) @Max(4) Integer unitDigits) {
    }

    public record BulkCreateResponse(int floorsCreated, int unitsCreated, List<String> codes) {
    }

    // ----- occupancy --------------------------------------------------------------------------

    /**
     * The three different questions that were all previously called "occupancy".
     *
     * <p>Before this, {@code /admin/inside} was the only thing carrying the word, and it answered
     * only the last of these -- how many visitors are on the premises right now. A developer
     * asking about occupancy means the first: how much of the project is lived in.
     */
    public record OccupancySummaryResponse(
            /** Units that exist at the addressable level. */
            long totalUnits,
            /** Units with a declared headcount or at least one active resident account. */
            long occupiedUnits,
            long vacantUnits,
            /** occupiedUnits / totalUnits, 0-1, rounded to 4dp. 0 when there are no units. */
            double occupancyRate,
            /** People living here, including those with no app account. */
            long residentHeadcount,
            /** Accounts that can actually sign in. Always <= headcount. */
            long registeredResidentAccounts,
            /** Visitors currently checked in at a gate. The live security number. */
            long visitorsInside) {
    }
}
