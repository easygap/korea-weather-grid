package io.github.easygap.weathergrid.service;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MonotonicQuotaTest {

    @Test
    void retryDelayRoundsUpAndAFullElapsedWindowReopensTheKey() {
        MonotonicQuota quota = new MonotonicQuota(2, Duration.ofSeconds(60), 10);

        assertEquals(0, quota.claim("client", 1_000_000_000L));
        assertEquals(0, quota.claim("client", 1_100_000_000L));
        assertEquals(60, quota.claim("client", 1_100_000_001L));
        assertEquals(1, quota.claim("client", 60_999_999_999L));
        assertEquals(0, quota.claim("client", 61_000_000_000L));
    }

    @Test
    void impossibleTickerRollbackStartsANewSafeWindow() {
        MonotonicQuota quota = new MonotonicQuota(1, Duration.ofMinutes(1), 2);

        assertEquals(0, quota.claim("client", 200));
        assertEquals(60, quota.claim("client", 200));
        assertEquals(0, quota.claim("client", 199));
    }

    @Test
    void accessOrderedEvictionKeepsTheMostRecentlyUsedKeys() {
        MonotonicQuota quota = new MonotonicQuota(1, Duration.ofMinutes(1), 2);

        quota.claim("alpha", 0);
        quota.claim("bravo", 0);
        assertEquals(60, quota.claim("alpha", 0));
        quota.claim("charlie", 0);

        assertEquals(0, quota.claim("bravo", 0));
        assertEquals(2, quota.trackedKeys());
    }

    @Test
    void concurrentClaimsNeverAdmitMoreThanTheConfiguredPermitCount() throws Exception {
        MonotonicQuota quota = new MonotonicQuota(5, Duration.ofMinutes(1), 1);
        var pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Long>> tasks = new ArrayList<>();
            for (int index = 0; index < 40; index++) {
                tasks.add(() -> quota.claim("shared", 0));
            }
            long admitted = pool.invokeAll(tasks).stream()
                    .filter(future -> {
                        try {
                            return future.get() == 0;
                        } catch (Exception failure) {
                            throw new AssertionError(failure);
                        }
                    })
                    .count();

            assertEquals(5, admitted);
        } finally {
            pool.shutdownNow();
            pool.awaitTermination(2, TimeUnit.SECONDS);
        }
    }
}
