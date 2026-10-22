# Source licensing and distribution

This revision adopts **GNU AGPL version 3 only**, identified as `AGPL-3.0-only`, for Xzare's first-party source and documentation. The complete, unmodified text is in [LICENSE](../LICENSE); the copyright notice is in [NOTICE](../NOTICE).

This replaces the proprietary notice for first-party files in this revision. Earlier commits record the previous licensing state. Third-party components keep their licenses, including fonts and each application's `THIRD_PARTY_NOTICES.txt`. Do not relabel those notices as AGPL or remove them when distributing a build.

AGPL allows use, study, modification and redistribution, including commercial use, subject to its terms. Distribution of covered software and remote interaction with modified versions can carry corresponding-source obligations; read the license, particularly sections 6 and 13, for the actual requirements. This explanation does not replace the license.

## Commercial desktop history

Existing operating guides describe Xzare's branded desktop distribution: activation leases, product-bound keys, offline grace periods and Windows packaging. These describe the implementation and historical deployment plans. They add no restriction to the rights granted by the source license.

You do not need a paid Xzare license to read, modify or test this source under AGPL. The core example and automated tests do not need the production activation authority. The branded desktop flow still checks activation; setting up a developer authority or changing that implementation is separate engineering work. No private issuing key is included or required to exercise core primitives.

`private: true` in workspace manifests prevents accidental npm publication. It does not make this repository or its license private.

Source availability does not establish security certification, production readiness, legal compliance or permission to imply that a modified build is endorsed by Xzare. Preserve source and third-party notices when redistributing.

## License provenance

The text was obtained from [SPDX's AGPL-3.0-only entry](https://github.com/spdx/license-list-data/blob/main/text/AGPL-3.0-only.txt). The [Free Software Foundation's AGPL page](https://www.gnu.org/licenses/agpl-3.0.html) provides the original text and further information.
