package io.github.easygap.weathergrid.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapProviderPropertiesTest {

    @Test
    void acceptsAnEmptyOrUuidFormattedApiKey() {
        MapProviderProperties empty = new MapProviderProperties("  ");
        String key = "12345678-1234-1234-1234-123456789abc";
        MapProviderProperties configured = new MapProviderProperties(key);

        assertFalse(empty.vworldEnabled());
        assertEquals("", empty.vworldApiKey());
        assertTrue(configured.vworldEnabled());
        assertEquals(key, configured.vworldApiKey());
    }

    @Test
    void rejectsMalformedKeysBeforeTheApplicationStarts() {
        assertThrows(IllegalArgumentException.class,
                () -> new MapProviderProperties("not-a-javascript-key"));
    }
}
