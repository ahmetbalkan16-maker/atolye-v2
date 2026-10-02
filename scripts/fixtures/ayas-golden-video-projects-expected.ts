/**
 * Stage 15O.3 — what the local deterministic engines make of each golden project, frozen.
 *
 * `inputDigest` is the project itself. `sceneSvgSha256` is the rendered bytes of each scene, in order. `outputDigest`
 * covers both reviews and every scene manifest. A change to the renderer, to a review or to a project shows here; the
 * values are replaced only by publishing a new golden vault version (`--print-expected` prints the current ones).
 */
export const AYAS_GOLDEN_VIDEO_EXPECTED: Readonly<Record<string, { readonly inputDigest: string; readonly sceneSvgSha256: readonly string[]; readonly outputDigest: string }>> = Object.freeze({
  "istanbul-1453": {
    inputDigest: "30ee8637201fbe9570b214d91607208ab39025ae594756c18239497e72fe1816",
    sceneSvgSha256: [
      "0b6d7d8f350add92cfcf0ab39cfa37e1737f42a32780c027f05e3baebc09975c",
      "b4d37a73b57a77cfb50e15e3b93341922dbc10621c2d2111a9c7ed4e932dfc78",
      "e91f90efcf87dcb033aa9a9f235a8daaee4350d3726475f1932903a3c82129cf",
      "1bf43a5c35fc974ca936b8b801fa96dea752f1fcbf9757600f122a2e57474ead",
      "8624253cc8b894b7035d93650e2bb133215d3f5dcc201b981c0fb7c9c3755258",
      "07e06d43613a94db86eb897274f0b611a052fe41b4b66ec8b00ac528feb6bd27",
      "91e77630bdcfd7d7502cfb752cf983a2b9e155e3353b8867751487534dcc3680",
      "1a6f9a6e7e9298bcb0ebde2e02efa86e034b080b483dd63bc6297cddf97e4361",
    ],
    outputDigest: "d1918da8189f96c4ab883ed1a9967fceeabc4d20fa5efc92ffea2c5ca0d84a8a",
  },
  "malazgirt-1071": {
    inputDigest: "816b8d3500e1dd0272f0bf94aad6ef6ef49deb77cf0c1d9aab784625d7b73c55",
    sceneSvgSha256: [
      "a6bc78ce113521d7494afe953bc46433362e39c9b2fe5c94ddce3e453bc050f5",
      "175252ee2c5df4ccdfbecb83a5cd69f16b7e0d5d7a79c714eafd5f5c289688e4",
      "2552022479bd147cf18a1de51111ce9415a82c16504a9f03ef40462e5795d13a",
      "681a1ea4490acf8482a700be6c15d69a47aa9a2341704bc8ae8241c270059d88",
      "c28257e930d3d7ef5d8b2c62813c59cf4c3528f3af9f4e9bc2b51516cb03554e",
      "a0881c0d5d9316c9cbc8c9d1438bdeccdde86935e4ef108b107da8c19071e909",
      "72f88b7a18a451d11a26554f34990802c4a88368de3a9070b5884e8fb5d15b2f",
      "a91188f2c620d1909ec8a364ddb6f22e793aebecce5cbdc8df8182fed75d7196",
    ],
    outputDigest: "609e3d1d518f01496799b32a30f4abe244fc4687a31cd42f7505e0700cfb9195",
  },
  "preveze-1538": {
    inputDigest: "12044bfd2949efd178efcdb1f34872be1928bec05e1bb9017afa0d149d3fbe8e",
    sceneSvgSha256: [
      "20aaeb544a1e94b9fd1e9a0785f953cb0198c06f1aa0845a8ab3c34fd1874ddf",
      "50e1d142efa0472974a17b1a066bb05accbdf1240bc8dafb47cb4643226cc9ac",
      "6c8650c4aed1578435e4dcbdb80fd552316f098a5fb920b32695a21eb084b5ef",
      "41b3a61727b0b6f3aff72f3bef04ffad327bded20ffd8bf7a08e867dd5d01695",
      "73e4eaa3db9d0d6a52873a68a770337bb3c8fb1a544a83a1ba277046b5193309",
      "9ddeba67e74fcd71a97b1c56b9a860ed770f150d7bcd4450a1057faf823d9c36",
      "4f29a95959bc2aef2059f23c8bd3ce3879846f987fe16cbdc09a14bbe1140962",
      "44905aca58f913c428fe8a6b7a1b6801cdff11c360c7103ee1734814c38904d5",
    ],
    outputDigest: "3eff8ba190c648e19d048d5d556936f4e03e9f6b1740ed3c4f5a9c08db44e04b",
  },
});
