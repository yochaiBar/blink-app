const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that adds modular_headers for specific Firebase pods.
 *
 * FirebaseAuth (Swift) depends on pods that don't define modules.
 * Instead of setting `use_modular_headers!` globally (which breaks other pods),
 * we target only the pods that need it.
 */
module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let podfile = fs.readFileSync(podfilePath, "utf8");

      // Add a post_install hook that sets modular headers for Firebase deps
      if (!podfile.includes("# Firebase modular headers fix")) {
        const snippet = `
# Firebase modular headers fix
pre_install do |installer|
  installer.pod_targets.each do |pod|
    if pod.name.start_with?('Firebase') ||
       pod.name.start_with?('GoogleUtilities') ||
       pod.name.start_with?('GTMSessionFetcher') ||
       pod.name == 'RecaptchaInterop' ||
       pod.name == 'GoogleDataTransport'
      def pod.build_type
        Pod::BuildType.static_library
      end
    end
  end
end
`;
        // Append before the last `end` or at the end
        podfile = podfile + "\n" + snippet;
        fs.writeFileSync(podfilePath, podfile, "utf8");
      }

      return cfg;
    },
  ]);
};
