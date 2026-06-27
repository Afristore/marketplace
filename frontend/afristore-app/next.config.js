const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingRoot: require("path").resolve(__dirname, "../../"),
    serverComponentsExternalPackages: ['@stellar/stellar-sdk', 'sodium-native'],
  },
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.pinata.cloud",
      },
      {
        protocol: "https",
        hostname: "ipfs.io",
      },
      {
        protocol: "https",
        hostname: "**.mypinata.cloud",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Stub out Node-only modules that @stellar/stellar-sdk pulls in
      // transitively (sodium-native, libsodium-wrappers, etc.).
      // Without these stubs, the client bundle emits critical warnings and
      // includes dead code that inflates the bundle size.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // Standard Node builtins
        fs: false,
        net: false,
        tls: false,
        // Stellar SDK native crypto modules — not available in the browser;
        // the SDK falls back to its wasm/js implementation automatically.
        "sodium-native": false,
        "libsodium-wrappers": false,
        // Other optional native deps pulled by stellar-base / stellar-sdk
        crypto: false,
      };
    }
    return config;
  },
  // Suppress the expected "Can't resolve 'sodium-native'" critical warnings
  // that Next.js surfaces from @stellar/stellar-sdk's optional native crypto.
  // These are intentional — the browser bundle uses the wasm fallback instead.
  //
  // Note: Next 15 exposes `ignoreDuringBuilds` under experimental — once stable
  // we can replace the webpack fallback stubs with a cleaner filterWarnings rule.
};

module.exports = withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
});
