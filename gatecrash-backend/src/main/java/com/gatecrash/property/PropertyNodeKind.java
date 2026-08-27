package com.gatecrash.property;

/**
 * What a level in the property tree <em>is</em>, structurally.
 *
 * <p>Deliberately small and fixed, and deliberately separate from what the level is
 * <em>called</em>. A developer may rename their level to "Pod" or "Sector" or "Jamat Khana
 * Wing" and the code keeps working, because nothing branches on the label -- it branches on
 * the kind. The moment nomenclature becomes load-bearing, renaming a label in the console
 * silently changes which rows a query matches.
 */
public enum PropertyNodeKind {

    /** A non-physical grouping: phase, cluster, sector, pocket. Purely organisational. */
    GROUP,

    /** A physical structure: tower, wing, block. */
    BUILDING,

    /** A storey within a building. The only kind that carries a storey number. */
    FLOOR,

    /**
     * The addressable leaf: flat, villa, plot, office. This is where a resident lives, where
     * a visitor is routed, and the only kind that carries occupancy. Exactly one level per
     * township is of this kind, and it is always the deepest.
     */
    UNIT;

    public boolean isUnit() {
        return this == UNIT;
    }

    /** A unit is a leaf: nothing may be filed inside someone's home. */
    public boolean canHaveChildren() {
        return this != UNIT;
    }

    public boolean carriesStoreyNumber() {
        return this == FLOOR;
    }
}
