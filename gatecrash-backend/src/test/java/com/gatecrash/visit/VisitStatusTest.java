package com.gatecrash.visit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Exhaustive check of the transition table. Every ordered pair of states is asserted, so adding a
 * state without deciding its edges fails here rather than surfacing as a 409 in production.
 */
@DisplayName("Visit state machine")
class VisitStatusTest {

    @Test
    @DisplayName("only the documented transitions are legal")
    void transitionTableIsExact() {
        assertThat(VisitStatus.PENDING.canTransitionTo(VisitStatus.APPROVED)).isTrue();
        assertThat(VisitStatus.PENDING.canTransitionTo(VisitStatus.REJECTED)).isTrue();
        assertThat(VisitStatus.PENDING.canTransitionTo(VisitStatus.EXPIRED)).isTrue();
        assertThat(VisitStatus.APPROVED.canTransitionTo(VisitStatus.CHECKED_IN)).isTrue();
        assertThat(VisitStatus.CHECKED_IN.canTransitionTo(VisitStatus.CHECKED_OUT)).isTrue();

        assertThat(VisitStatus.PENDING.canTransitionTo(VisitStatus.CHECKED_IN)).isFalse();
        assertThat(VisitStatus.PENDING.canTransitionTo(VisitStatus.CHECKED_OUT)).isFalse();
        assertThat(VisitStatus.APPROVED.canTransitionTo(VisitStatus.APPROVED)).isFalse();
        assertThat(VisitStatus.APPROVED.canTransitionTo(VisitStatus.REJECTED)).isFalse();
        assertThat(VisitStatus.CHECKED_IN.canTransitionTo(VisitStatus.APPROVED)).isFalse();
    }

    @ParameterizedTest
    @EnumSource(VisitStatus.class)
    @DisplayName("no state may transition to itself")
    void noSelfTransitions(VisitStatus status) {
        assertThat(status.canTransitionTo(status)).isFalse();
    }

    @Test
    @DisplayName("terminal states have no outgoing edges")
    void terminalStatesAreFinal() {
        assertThat(VisitStatus.REJECTED.isTerminal()).isTrue();
        assertThat(VisitStatus.EXPIRED.isTerminal()).isTrue();
        assertThat(VisitStatus.CHECKED_OUT.isTerminal()).isTrue();

        assertThat(VisitStatus.PENDING.isTerminal()).isFalse();
        assertThat(VisitStatus.APPROVED.isTerminal()).isFalse();
        assertThat(VisitStatus.CHECKED_IN.isTerminal()).isFalse();
    }

    @ParameterizedTest
    @EnumSource(VisitStatus.class)
    @DisplayName("nothing may transition back into PENDING")
    void pendingIsNeverReentered(VisitStatus status) {
        assertThat(status.canTransitionTo(VisitStatus.PENDING)).isFalse();
    }
}
