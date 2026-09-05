import { CORE_PACKAGE_VERSION } from "@actuarial-ts/core";

// Run and binding identities include package stamps; numerical result identity
// does not. Keep explicit reviewed expectations for each release, not generated
// expectations that would silently accept a future version or math change.
export const emptyGridReleaseTags = {
  "0.6.1": {
    run: "fnv1a64-jcs-v1:273310b653febde9",
    result: "fnv1a64-jcs-v1:0b93f7451976f636",
    binding: "fnv1a64-jcs-v1:21e8150663626470",
  },
  "0.7.0": {
    run: "fnv1a64-jcs-v1:1ab483bf2be397d5",
    result: "fnv1a64-jcs-v1:0b93f7451976f636",
    binding: "fnv1a64-jcs-v1:02b3a4b76e037ff7",
  },
  "0.7.1": {
    run: "fnv1a64-jcs-v1:9bf7c838f44b7b10",
    result: "fnv1a64-jcs-v1:0b93f7451976f636",
    binding: "fnv1a64-jcs-v1:e87250ad8728c035",
  },
} as const;

export const currentEmptyGridReleaseTags =
  emptyGridReleaseTags[CORE_PACKAGE_VERSION];
