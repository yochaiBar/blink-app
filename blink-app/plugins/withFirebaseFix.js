const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that fixes Firebase Swift pod compilation.
 *
 * FirebaseAuth (Swift) depends on pods that don't define modules.
 * We set $RNFirebaseAsStaticFramework and add modular_headers for
 * the specific pods that need it, without using useFrameworks globally.
 */
module.exports = function withFirebaseFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (podfile.includes("# RNFB static framework fix")) {
        return cfg;
      }

      // Add $RNFirebaseAsStaticFramework at the top of the Podfile
      const topSnippet = `# RNFB static framework fix
$RNFirebaseAsStaticFramework = true
`;

      // Add modular_headers for Firebase deps + allow non-modular includes
      const postInstallSnippet = `
    # Firebase modular headers fix
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end`;

      // Insert the static framework variable at the top
      podfile = topSnippet + podfile;

      // Inject into existing post_install block
      if (podfile.includes("post_install do |installer|")) {
        podfile = podfile.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|${postInstallSnippet}`
        );
      } else {
        podfile += `\npost_install do |installer|${postInstallSnippet}\nend\n`;
      }

      fs.writeFileSync(podfilePath, podfile, "utf8");
      return cfg;
    },
  ]);
};
