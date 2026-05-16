#!/usr/bin/env node
/**
 * Add a MailroomClip App Clip target to the Mailroom Xcode project.
 *
 * Uses the `xcode` npm lib (transitive dep of expo) for safe .pbxproj
 * mutation. Idempotent — checks if MailroomClip already exists before
 * adding anything.
 *
 * What it adds:
 *   - PBXNativeTarget "MailroomClip" (productType = on-demand-install-capable
 *     app extension, which is the App Clip type)
 *   - Build phases: Sources (Swift files), Resources, Frameworks
 *   - Source files: MailroomClipApp.swift, ContentView.swift
 *   - Info.plist + entitlements references
 *   - Build configurations (Debug, Release) with App Clip-specific build
 *     settings (PRODUCT_BUNDLE_IDENTIFIER, CODE_SIGN_ENTITLEMENTS, etc.)
 *   - "Embed App Clips" copy phase on the Mailroom target
 *   - Dependency: Mailroom depends on MailroomClip so they build together
 *
 * Run: node scripts/add-app-clip-target.js
 */
const xcode = require('xcode');
const path = require('path');
const fs = require('fs');

// Monkey-patch the xcode lib to know about App Clip product types.
// The lib's producttypeForTargettype map only had types Apple shipped
// before iOS 14. We add the App Clip type so addTarget() accepts it.
const pbxProjectModule = require('xcode/lib/pbxProject.js');
const origAddTarget = pbxProjectModule.prototype.addTarget;
pbxProjectModule.prototype.addTarget = function(name, type, subfolder, bundleId) {
  // Inject the App Clip type into the lib's internal map if it's not there.
  // The map is a closure inside producttypeForTargettype but we can side-
  // step by special-casing 'app_clip' to look like 'application' for the
  // type-validation gate, then patching the product type after.
  if (type === 'app_clip') {
    // Pretend it's an application for the validation step.
    const target = origAddTarget.call(this, name, 'application', subfolder, bundleId);
    // Now patch the product type on the native-target entry.
    const nt = this.pbxNativeTargetSection()[target.uuid];
    if (nt) {
      nt.productType = '"com.apple.product-type.application.on-demand-install-capable"';
    }
    return target;
  }
  return origAddTarget.call(this, name, type, subfolder, bundleId);
};

const PROJECT_PATH = path.resolve(__dirname, '../ios/Mailroom.xcodeproj/project.pbxproj');
const CLIP_TARGET_NAME = 'MailroomClip';
const CLIP_BUNDLE_ID = 'com.mailrooms.app.Clip';
const TEAM_ID = '824QVPJ3B5';
const SWIFT_VERSION = '5.0';
const IOS_DEPLOYMENT_TARGET = '15.0'; // App Clips require iOS 14+

const proj = xcode.project(PROJECT_PATH);

proj.parse((err) => {
  if (err) {
    console.error('Failed to parse pbxproj:', err);
    process.exit(1);
  }

  // ---- Check idempotency ----
  const existingTargets = proj.pbxNativeTargetSection();
  for (const uuid in existingTargets) {
    const t = existingTargets[uuid];
    if (typeof t === 'object' && t.name === CLIP_TARGET_NAME) {
      console.log(`✓ ${CLIP_TARGET_NAME} target already exists. Nothing to do.`);
      process.exit(0);
    }
  }

  // ---- Add the App Clip target ----
  const clipTarget = proj.addTarget(
    CLIP_TARGET_NAME,
    'app_clip',
    CLIP_TARGET_NAME,
    CLIP_BUNDLE_ID,
  );
  console.log(`✓ Added target ${CLIP_TARGET_NAME} (uuid=${clipTarget.uuid})`);

  // ---- Add a PBXGroup for the App Clip sources ----
  // First check if the group already exists
  let clipGroup = null;
  const groups = proj.pbxGroupSection();
  for (const uuid in groups) {
    const g = groups[uuid];
    if (typeof g === 'object' && g.name === CLIP_TARGET_NAME) {
      clipGroup = { uuid, group: g };
      break;
    }
  }
  if (!clipGroup) {
    const groupUuid = proj.pbxCreateGroup(CLIP_TARGET_NAME, CLIP_TARGET_NAME);
    clipGroup = { uuid: groupUuid, group: groups[groupUuid] };
    // Add to root group
    const mainGroupUuid = proj.getFirstProject().firstProject.mainGroup;
    proj.addToPbxGroup(groupUuid, mainGroupUuid);
    console.log(`✓ Added PBXGroup ${CLIP_TARGET_NAME}`);
  }

  // ---- Add Swift source files to the target ----
  const sourceFiles = ['MailroomClipApp.swift', 'ContentView.swift'];
  for (const fname of sourceFiles) {
    const fileRef = proj.addSourceFile(
      fname,
      { target: clipTarget.uuid },
      clipGroup.uuid,
    );
    console.log(`✓ Added source ${fname} (uuid=${fileRef.uuid})`);
  }

  // ---- Add resource files (Info.plist, entitlements) ----
  // These need to be referenced for the file picker, but Info.plist is
  // assigned via build setting (INFOPLIST_FILE) not as a Resource.
  const resourceFiles = ['Info.plist', 'MailroomClip.entitlements'];
  for (const fname of resourceFiles) {
    proj.addFile(
      fname,
      clipGroup.uuid,
      { target: clipTarget.uuid },
    );
    console.log(`✓ Added file ref ${fname}`);
  }

  // ---- Configure build settings on the clip target ----
  const configList = proj.getBuildConfigByList(
    proj.pbxXCConfigurationList()[clipTarget.pbxNativeTarget.buildConfigurationList].buildConfigurations,
  );
  // Different approach: iterate the configs by uuid
  const allConfigs = proj.pbxXCBuildConfigurationSection();
  const targetConfigListUuid = clipTarget.pbxNativeTarget.buildConfigurationList;
  const targetConfigList = proj.pbxXCConfigurationList()[targetConfigListUuid];
  for (const cfg of targetConfigList.buildConfigurations) {
    const cfgUuid = cfg.value;
    const cfgObj = allConfigs[cfgUuid];
    if (!cfgObj || typeof cfgObj !== 'object') continue;
    cfgObj.buildSettings = cfgObj.buildSettings || {};
    Object.assign(cfgObj.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: CLIP_BUNDLE_ID,
      PRODUCT_NAME: `"$(TARGET_NAME)"`,
      INFOPLIST_FILE: `${CLIP_TARGET_NAME}/Info.plist`,
      CODE_SIGN_ENTITLEMENTS: `${CLIP_TARGET_NAME}/${CLIP_TARGET_NAME}.entitlements`,
      DEVELOPMENT_TEAM: TEAM_ID,
      SWIFT_VERSION,
      IPHONEOS_DEPLOYMENT_TARGET: IOS_DEPLOYMENT_TARGET,
      TARGETED_DEVICE_FAMILY: '"1,2"',
      CODE_SIGN_STYLE: 'Automatic',
      ENABLE_BITCODE: 'NO',
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      SUPPORTS_MACCATALYST: 'NO',
      CURRENT_PROJECT_VERSION: '1',
      MARKETING_VERSION: '0.7.0',
    });
  }
  console.log('✓ Configured Debug + Release build settings');

  // ---- Embed App Clip in the main app ----
  // Find the Mailroom target
  let mainTargetUuid = null;
  for (const uuid in existingTargets) {
    const t = existingTargets[uuid];
    if (typeof t === 'object' && t.name === 'Mailroom') {
      mainTargetUuid = uuid;
      break;
    }
  }
  if (!mainTargetUuid) {
    console.error('Could not find Mailroom main target');
    process.exit(1);
  }

  // Add a target dependency: Mailroom depends on MailroomClip
  proj.addTargetDependency(mainTargetUuid, [clipTarget.uuid]);
  console.log('✓ Added Mailroom → MailroomClip target dependency');

  // Add the "Embed App Clips" Copy Files build phase to Mailroom.
  // The xcode lib's addBuildPhase handles the structure.
  proj.addBuildPhase(
    [`${CLIP_TARGET_NAME}.app`],
    'PBXCopyFilesBuildPhase',
    'Embed App Clips',
    mainTargetUuid,
    'application',
    '"$(CONTENTS_FOLDER_PATH)/AppClips"',
  );
  console.log('✓ Added Embed App Clips build phase to Mailroom');

  // ---- Save ----
  fs.writeFileSync(PROJECT_PATH, proj.writeSync());
  console.log('✓ Wrote pbxproj');
});
