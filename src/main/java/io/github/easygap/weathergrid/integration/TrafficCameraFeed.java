package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Decodes the documented ITS CCTV JSON fields into a provider-neutral camera record. */
@Component
public final class TrafficCameraFeed {

    private static final int RAW_ITEM_LIMIT = 5_000;
    private static final String MEDIA_HOST = "cctvsec.ktict.co.kr";

    private final TrafficCameraGateway gateway;

    public TrafficCameraFeed(TrafficCameraGateway gateway) {
        this.gateway = gateway;
    }

    public Batch retrieve(double south, double north, double west, double east) {
        Batch decoded = decode(gateway.fetch(south, north, west, east));
        List<Camera> inside = decoded.cameras.stream()
                .filter(camera -> camera.latitude >= south - 1e-7 && camera.latitude <= north + 1e-7
                        && camera.longitude >= west - 1e-7 && camera.longitude <= east + 1e-7)
                .toList();
        return new Batch(inside, decoded.truncated || inside.size() != decoded.cameras.size());
    }

    private static Batch decode(JsonNode root) {
        if (root == null || !root.isObject()) throw new UpstreamUnavailableException();
        JsonNode payload = root.has("response") ? root.get("response") : root;
        if (payload == null || !payload.isObject()) throw new UpstreamUnavailableException();

        JsonNode header = payload.get("header");
        if (header != null && header.isObject() && header.has("resultCode")) {
            String resultCode = scalar(header.get("resultCode"), 16);
            if (!"0".equals(resultCode) && !"00".equals(resultCode)) {
                throw new UpstreamUnavailableException();
            }
        }

        int declaredCount = nonNegativeInteger(payload.get("datacount"));
        JsonNode data = payload.get("data");
        if (declaredCount > 0 && (data == null || data.isNull())) {
            throw new UpstreamUnavailableException();
        }

        List<JsonNode> raw = new ArrayList<>();
        int actualCount = 0;
        if (data != null && !data.isNull()) {
            if (data.isArray()) {
                actualCount = data.size();
                int limit = Math.min(actualCount, RAW_ITEM_LIMIT);
                for (int index = 0; index < limit; index++) raw.add(data.get(index));
            } else if (data.isObject()) {
                actualCount = 1;
                raw.add(data);
            } else {
                throw new UpstreamUnavailableException();
            }
        }

        boolean incomplete = declaredCount != actualCount || actualCount > RAW_ITEM_LIMIT;
        List<Camera> cameras = new ArrayList<>(raw.size());
        for (JsonNode item : raw) {
            Camera camera = camera(item);
            if (camera == null) incomplete = true;
            else cameras.add(camera);
        }
        if (declaredCount > 0 && cameras.isEmpty()) throw new UpstreamUnavailableException();
        return new Batch(List.copyOf(cameras), incomplete);
    }

    private static Camera camera(JsonNode item) {
        if (item == null || !item.isObject()) return null;
        String type = scalar(item.get("cctvtype"), 8);
        String format = scalar(item.get("cctvformat"), 32);
        String name = scalar(item.get("cctvname"), 200);
        String stream = scalar(item.get("cctvurl"), 2_048);
        Double longitude = coordinate(item.get("coordx"));
        Double latitude = coordinate(item.get("coordy"));
        if (!"4".equals(type) || format == null || !"HLS".equals(format.toUpperCase(Locale.ROOT))
                || name == null || stream == null || longitude == null || latitude == null
                || latitude < 30 || latitude > 45 || longitude < 120 || longitude > 135
                || !approvedMediaUrl(stream)) {
            return null;
        }

        String roadSection = scalar(item.get("roadsectionid"), 128);
        String resolution = scalar(item.get("cctvresolution"), 64);
        String createdAt = scalar(item.get("filecreatetime"), 32);
        return new Camera(stableId(roadSection, name, latitude, longitude), name,
                latitude, longitude, stream, resolution, createdAt, roadSection);
    }

    private static boolean approvedMediaUrl(String value) {
        try {
            URI uri = URI.create(value);
            int port = uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme())
                    && MEDIA_HOST.equalsIgnoreCase(uri.getHost())
                    && (port == -1 || port == 443)
                    && uri.getUserInfo() == null
                    && uri.getFragment() == null
                    && uri.getRawQuery() == null
                    && uri.getRawPath() != null
                    && !uri.getRawPath().isBlank()
                    && !"/".equals(uri.getRawPath());
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static int nonNegativeInteger(JsonNode node) {
        String text = scalar(node, 7);
        if (text == null || !text.chars().allMatch(Character::isDigit)) {
            throw new UpstreamUnavailableException();
        }
        try {
            int value = Integer.parseInt(text);
            if (value > 100_000) throw new UpstreamUnavailableException();
            return value;
        } catch (NumberFormatException ignored) {
            throw new UpstreamUnavailableException();
        }
    }

    private static Double coordinate(JsonNode node) {
        String text = scalar(node, 40);
        if (text == null) return null;
        try {
            double value = Double.parseDouble(text);
            return Double.isFinite(value) ? value : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static String scalar(JsonNode node, int maxLength) {
        if (node == null || node.isNull() || !node.isValueNode()) return null;
        String raw = node.asString();
        if (raw == null || raw.chars().anyMatch(Character::isISOControl)) return null;
        String value = raw.strip();
        return value.isEmpty() || value.length() > maxLength ? null : value;
    }

    private static String stableId(String roadSection, String name,
                                   double latitude, double longitude) {
        return String.format(Locale.ROOT, "%s%s@%.7f,%.7f",
                roadSection == null ? "" : roadSection + "|", name, latitude, longitude);
    }

    public record Camera(String id, String name, double latitude, double longitude,
                         String streamUrl, String resolution, String fileCreatedAt,
                         String roadSectionId) {
    }

    public record Batch(List<Camera> cameras, boolean truncated) {
        public Batch {
            cameras = List.copyOf(cameras);
        }
    }
}
