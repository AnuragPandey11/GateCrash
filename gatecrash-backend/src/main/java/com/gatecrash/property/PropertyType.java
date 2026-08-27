package com.gatecrash.property;

import java.util.List;

/**
 * The kind of real-estate project a township is, and the level set it starts with.
 *
 * <p>This exists to make onboarding a developer a one-click affair rather than a data-modelling
 * exercise: a super admin picks "Villa community" and the township comes up with Clusters and
 * Villas already named, instead of an empty tree and a prompt asking how many levels they would
 * like. It is the first question on the onboarding form for that reason.
 *
 * <p>It is a <em>starting point</em>, not a constraint. Every label here is editable afterwards,
 * levels can be added or removed, and a super admin can supply an entirely custom level set at
 * onboarding instead of picking one of these. Nothing in the system branches on this value --
 * {@link PropertyNodeKind} is what code reasons about. Keeping the type on the row anyway pays for
 * itself in the console (sensible presets when adding a second phase) and in platform reporting
 * (group like projects together).
 *
 * <p>The vocabulary is the one the industry actually uses on site plans and price lists: a
 * high-rise sells "3BHK apartments in Tower C", a gated community sells "villas in the Rose
 * cluster", a land developer sells "plots in Sector 7", a mall leases "Shop G-12 on the Ground
 * level", and a co-living operator rents "Bed 2 in Room 304". Getting these words right is most of
 * what makes the console feel like it was built for that developer.
 *
 * <p>{@link Category} groups them so a picker of this length stays navigable.
 */
public enum PropertyType {

    // ----- Residential --------------------------------------------------------------------

    /** High-rise / mid-rise apartments. The classic Tower -> Floor -> Flat. */
    APARTMENT(Category.RESIDENTIAL, "Apartment complex",
            "Towers of floors of flats. The default for most urban housing projects.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Tower", "Towers"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Flat", "Flats"))),

    /**
     * Gated villa community. No floor level: a villa may well have three storeys, but they are not
     * separately addressable -- the villa is the unit, and a visitor is routed to it whole.
     */
    VILLA(Category.RESIDENTIAL, "Villa community",
            "Clusters of independent villas. No floor level -- a villa is addressed whole.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Cluster", "Clusters"),
            new LevelPreset(PropertyNodeKind.UNIT, "Villa", "Villas"))),

    /** Row houses / townhouses, addressed off a block or row. */
    ROW_HOUSE(Category.RESIDENTIAL, "Row house community",
            "Blocks of row houses sharing side walls.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Block", "Blocks"),
            new LevelPreset(PropertyNodeKind.UNIT, "Row House", "Row Houses"))),

    /** Plotted land development: the unit is a plot, which may not be built on at all. */
    PLOTTED(Category.RESIDENTIAL, "Plotted development",
            "Sectors of plots. A plot may be sold and gated long before anything is built on it.",
            List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Sector", "Sectors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Plot", "Plots"))),

    /**
     * Large integrated township developed in phases. Four levels deep, which is what distinguishes
     * it from {@link #APARTMENT}: the phase is a real addressing level residents use, not decoration.
     */
    GATED_TOWNSHIP(Category.RESIDENTIAL, "Integrated township",
            "Phases of blocks of floors of flats, for a project handed over in stages.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Phase", "Phases"),
            new LevelPreset(PropertyNodeKind.BUILDING, "Block", "Blocks"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Flat", "Flats"))),

    /**
     * Co-living and paying-guest accommodation. The unit is a <em>room</em>, not a flat: occupants
     * are unrelated, arrive and leave independently, and a visitor is routed to one of them rather
     * than to a household.
     */
    CO_LIVING(Category.RESIDENTIAL, "Co-living / PG",
            "Buildings of floors of rooms. Occupants are unrelated and turn over independently.",
            List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Building", "Buildings"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Room", "Rooms"))),

    /** Student hostels. Same shape as co-living; different vocabulary and different operator. */
    STUDENT_HOUSING(Category.RESIDENTIAL, "Student housing",
            "Hostel blocks of floors of rooms.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Hostel Block", "Hostel Blocks"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Room", "Rooms"))),

    /** Retirement and assisted-living communities. */
    SENIOR_LIVING(Category.RESIDENTIAL, "Senior living",
            "Blocks of floors of suites, for retirement and assisted-living communities.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Block", "Blocks"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Suite", "Suites"))),

    /** Serviced apartments and short-stay residences. */
    SERVICED_APARTMENT(Category.RESIDENTIAL, "Serviced apartments",
            "Towers of floors of serviced suites with high guest turnover.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Tower", "Towers"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Suite", "Suites"))),

    /** Farmhouse and agricultural plot developments. */
    FARMHOUSE(Category.RESIDENTIAL, "Farmhouse plots",
            "Phases of farm plots, typically large and sparsely occupied.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Phase", "Phases"),
            new LevelPreset(PropertyNodeKind.UNIT, "Farm Plot", "Farm Plots"))),

    // ----- Commercial ---------------------------------------------------------------------

    /** Office towers. */
    COMMERCIAL(Category.COMMERCIAL, "Commercial complex",
            "Towers of floors of offices.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Tower", "Towers"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Office", "Offices"))),

    /** IT / business parks, which address suites within blocks rather than whole floors. */
    IT_PARK(Category.COMMERCIAL, "IT / business park",
            "Blocks of floors of suites, each let to a different company.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Block", "Blocks"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Suite", "Suites"))),

    /**
     * Malls and retail centres. Note the floor level is called a "Level" here, which is the word
     * every mall directory in the country uses -- and is exactly the kind of detail that makes the
     * console read as though it was built for a mall operator.
     */
    RETAIL(Category.COMMERCIAL, "Mall / retail centre",
            "Levels of shops. Visitors are routed to a tenant, not to a resident.", List.of(
            new LevelPreset(PropertyNodeKind.BUILDING, "Mall", "Malls"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Level", "Levels"),
            new LevelPreset(PropertyNodeKind.UNIT, "Shop", "Shops"))),

    /** Industrial estates and logistics parks. */
    INDUSTRIAL(Category.COMMERCIAL, "Industrial / logistics park",
            "Phases of sheds and warehouses, addressed at ground level.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Phase", "Phases"),
            new LevelPreset(PropertyNodeKind.UNIT, "Unit", "Units"))),

    // ----- Mixed --------------------------------------------------------------------------

    /**
     * Anything that mixes shapes. Starts deepest, because it is easier for an admin to delete a
     * level they do not need than to discover after handover that they needed one -- the level set
     * cannot be reshaped once the tree holds anything.
     */
    MIXED_USE(Category.MIXED, "Mixed-use development",
            "Phases of buildings of floors of units, mixing residential and commercial.", List.of(
            new LevelPreset(PropertyNodeKind.GROUP, "Phase", "Phases"),
            new LevelPreset(PropertyNodeKind.BUILDING, "Building", "Buildings"),
            new LevelPreset(PropertyNodeKind.FLOOR, "Floor", "Floors"),
            new LevelPreset(PropertyNodeKind.UNIT, "Unit", "Units")));

    /** Groups the picker, which is otherwise fifteen items of undifferentiated dropdown. */
    public enum Category {
        RESIDENTIAL("Residential"),
        COMMERCIAL("Commercial"),
        MIXED("Mixed use");

        private final String label;

        Category(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    private final Category category;
    private final String displayName;
    private final String description;
    private final List<LevelPreset> levels;

    PropertyType(Category category, String displayName, String description,
                 List<LevelPreset> levels) {
        this.category = category;
        this.displayName = displayName;
        this.description = description;
        this.levels = levels;
    }

    public Category category() {
        return category;
    }

    public String displayName() {
        return displayName;
    }

    /** One line explaining what this shape is for, shown under the option in the picker. */
    public String description() {
        return description;
    }

    /** The level set a township of this type is seeded with, shallowest first. */
    public List<LevelPreset> levels() {
        return levels;
    }

    public boolean hasFloors() {
        return levels.stream().anyMatch(l -> l.kind() == PropertyNodeKind.FLOOR);
    }

    /** One seeded level: its structural kind plus the developer's word for it. */
    public record LevelPreset(PropertyNodeKind kind, String singular, String plural) {
    }
}
