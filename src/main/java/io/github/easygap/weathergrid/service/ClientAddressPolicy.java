package io.github.easygap.weathergrid.service;

import jakarta.servlet.http.HttpServletRequest;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Resolves a stable client address without trusting caller-supplied forwarding headers. */
final class ClientAddressPolicy {

    private final List<IpNetwork> trustedPeers;

    ClientAddressPolicy(String trustedProxyCidrs) {
        trustedPeers = parseNetworks(trustedProxyCidrs);
    }

    String identify(HttpServletRequest request) {
        IpLiteral peer = IpLiteral.parse(request.getRemoteAddr());
        if (peer == null) return "unknown";
        if (trustedPeers.stream().anyMatch(network -> network.contains(peer))) {
            IpLiteral forwarded = IpLiteral.parse(request.getHeader("CF-Connecting-IP"));
            if (forwarded != null) return forwarded.canonical();
        }
        return peer.canonical();
    }

    private static List<IpNetwork> parseNetworks(String source) {
        if (source == null || source.isBlank()) return List.of();
        List<IpNetwork> result = new ArrayList<>();
        for (String token : source.trim().split("[,\\s]+")) {
            result.add(IpNetwork.parse(token));
        }
        return List.copyOf(result);
    }

    private record IpLiteral(byte[] bytes, String canonical) {
        private static IpLiteral parse(String source) {
            if (source == null) return null;
            String candidate = source.trim();
            if (candidate.isEmpty() || candidate.length() > 45 || candidate.contains("%")) return null;
            boolean ipv6 = candidate.indexOf(':') >= 0;
            if (ipv6) {
                if (!candidate.matches("[0-9A-Fa-f:.]+")) return null;
            } else if (!validIpv4(candidate)) {
                return null;
            }
            try {
                InetAddress address = InetAddress.getByName(candidate);
                return new IpLiteral(address.getAddress(), address.getHostAddress());
            } catch (Exception ignored) {
                return null;
            }
        }

        private static boolean validIpv4(String candidate) {
            String[] octets = candidate.split("\\.", -1);
            if (octets.length != 4) return false;
            for (String octet : octets) {
                if (!octet.matches("\\d{1,3}")) return false;
                if (Integer.parseInt(octet) > 255) return false;
            }
            return true;
        }
    }

    private record IpNetwork(byte[] networkBytes, int prefixLength) {
        private static IpNetwork parse(String source) {
            String[] sections = source.split("/", -1);
            if (sections.length > 2) throw invalid(source);
            IpLiteral address = IpLiteral.parse(sections[0]);
            if (address == null) throw invalid(source);
            int bitCount = address.bytes().length * 8;
            int prefix = bitCount;
            if (sections.length == 2) {
                try {
                    prefix = Integer.parseInt(sections[1]);
                } catch (NumberFormatException failure) {
                    throw invalid(source);
                }
            }
            if (prefix < 0 || prefix > bitCount) throw invalid(source);
            byte[] network = address.bytes().clone();
            for (int bit = prefix; bit < bitCount; bit++) {
                network[bit / 8] &= (byte) ~(1 << (7 - bit % 8));
            }
            return new IpNetwork(network, prefix);
        }

        private boolean contains(IpLiteral candidate) {
            if (candidate.bytes().length != networkBytes.length) return false;
            int wholeBytes = prefixLength / 8;
            if (!Arrays.equals(networkBytes, 0, wholeBytes,
                    candidate.bytes(), 0, wholeBytes)) return false;
            int remainingBits = prefixLength % 8;
            if (remainingBits == 0) return true;
            int mask = 0xff << (8 - remainingBits);
            return (networkBytes[wholeBytes] & mask) == (candidate.bytes()[wholeBytes] & mask);
        }

        private static IllegalArgumentException invalid(String source) {
            return new IllegalArgumentException("Invalid trusted proxy CIDR: " + source);
        }
    }
}
