package com.gatecrash.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Defers a side effect until the surrounding transaction has actually committed.
 *
 * <p>Push notifications and WebSocket frames are not transactional. Firing them inline means a
 * transaction that later rolls back has already told a resident someone is at their gate, and told
 * the guard's tablet a visit exists that the database has no record of. Once sent, neither can be
 * recalled -- so they wait for the commit.
 *
 * <p>Outside a transaction the action runs immediately, which keeps callers usable from tests and
 * from scheduled jobs that manage their own boundaries.
 */
@Component
public class AfterCommitExecutor {

    private static final Logger log = LoggerFactory.getLogger(AfterCommitExecutor.class);

    public void execute(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            run(action);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                run(action);
            }
        });
    }

    /**
     * A failed notification must never propagate: by the time this runs the business transaction has
     * committed and is beyond rescue, so throwing here would only corrupt the response.
     */
    private void run(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException ex) {
            log.error("Post-commit action failed", ex);
        }
    }
}
