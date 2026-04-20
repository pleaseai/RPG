# Changelog

## [0.1.32](https://github.com/pleaseai/soop/compare/soop-v0.1.31...soop-v0.1.32) (2026-04-02)


### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))
* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
* **soop-native:** split platform binaries into @pleaseai/soop-native package ([#194](https://github.com/pleaseai/soop/issues/194)) ([facd2ca](https://github.com/pleaseai/soop/commit/facd2ca62dd14cb9f5f53c305ea73f262e2b2ec8))


### Bug Fixes

* add workspace dependencies to trigger release-please cascade bumps ([#175](https://github.com/pleaseai/soop/issues/175)) ([ce5ff56](https://github.com/pleaseai/soop/commit/ce5ff56938a97bee00662ba63fc2c09729606960))
* **build:** fix Bun.build compile API and add robustness to generate-packages script ([#131](https://github.com/pleaseai/soop/issues/131)) ([24e8609](https://github.com/pleaseai/soop/commit/24e86096ef0dac509d59417ad424e875eb31a4e9))
* **build:** fix release build failures from wasm imports and stale artifact check ([#256](https://github.com/pleaseai/soop/issues/256)) ([b14c5b8](https://github.com/pleaseai/soop/commit/b14c5b8bc42ad9a32eac99261888f1689df38838))
* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))
* **release:** promote @pleaseai/soop from alpha to stable 0.1.31 ([#275](https://github.com/pleaseai/soop/issues/275)) ([f256f5d](https://github.com/pleaseai/soop/commit/f256f5d7c28ad72b879e3bece590f6f51ced86ed))
* resolve bun install -g failure and correct CI command name ([#135](https://github.com/pleaseai/soop/issues/135)) ([6af1dc3](https://github.com/pleaseai/soop/commit/6af1dc379ea4342922c193a3519188fc927e2225))
* **soop:** strip workspace devDependencies on npm publish ([#181](https://github.com/pleaseai/soop/issues/181)) ([c310452](https://github.com/pleaseai/soop/commit/c310452dbfe8dafa8d47a960466a8a43464da30c))
* **soop:** update minimum Node.js requirement to 24 ([#198](https://github.com/pleaseai/soop/issues/198)) ([a4cffad](https://github.com/pleaseai/soop/commit/a4cffad23c31111e5049bda1e982f2e72cc2af10))

## [0.1.31-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.30-alpha.1...soop-v0.1.31-alpha.1) (2026-04-02)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.2.4
    * @pleaseai/soop-encoder bumped to 0.3.2
    * @pleaseai/soop-graph bumped to 0.1.12
    * @pleaseai/soop-mcp bumped to 0.4.2
    * @pleaseai/soop-tools bumped to 0.1.14
    * @pleaseai/soop-zerorepo bumped to 0.1.12

## [0.1.30-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.29-alpha.1...soop-v0.1.30-alpha.1) (2026-03-28)


### Bug Fixes

* **build:** fix release build failures from wasm imports and stale artifact check ([#256](https://github.com/pleaseai/soop/issues/256)) ([b14c5b8](https://github.com/pleaseai/soop/commit/b14c5b8bc42ad9a32eac99261888f1689df38838))

## [0.1.29-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.28-alpha.1...soop-v0.1.29-alpha.1) (2026-03-20)


### Bug Fixes

* **encoder:** spread Map.entries() to array before calling toSorted ([#251](https://github.com/pleaseai/soop/issues/251)) ([8a49ae5](https://github.com/pleaseai/soop/commit/8a49ae5dc0f21f9e684d509382289557e8347889))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.2.3
    * @pleaseai/soop-encoder bumped to 0.3.1
    * @pleaseai/soop-graph bumped to 0.1.11
    * @pleaseai/soop-mcp bumped to 0.4.1
    * @pleaseai/soop-store bumped to 0.1.9
    * @pleaseai/soop-tools bumped to 0.1.13
    * @pleaseai/soop-utils bumped to 0.1.9
    * @pleaseai/soop-zerorepo bumped to 0.1.11

## [0.1.28-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.27-alpha.1...soop-v0.1.28-alpha.1) (2026-03-16)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.2.2
    * @pleaseai/soop-mcp bumped to 0.4.0

## [0.1.27-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.26-alpha.1...soop-v0.1.27-alpha.1) (2026-03-16)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.2.1
    * @pleaseai/soop-encoder bumped to 0.3.0
    * @pleaseai/soop-graph bumped to 0.1.10
    * @pleaseai/soop-mcp bumped to 0.3.0
    * @pleaseai/soop-tools bumped to 0.1.12
    * @pleaseai/soop-zerorepo bumped to 0.1.10

## [0.1.26-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.25-alpha.1...soop-v0.1.26-alpha.1) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.2.0
    * @pleaseai/soop-encoder bumped to 0.2.0
    * @pleaseai/soop-graph bumped to 0.1.9
    * @pleaseai/soop-mcp bumped to 0.2.0
    * @pleaseai/soop-store bumped to 0.1.8
    * @pleaseai/soop-tools bumped to 0.1.11
    * @pleaseai/soop-utils bumped to 0.1.8
    * @pleaseai/soop-zerorepo bumped to 0.1.9

## [0.1.25-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.24-alpha.1...soop-v0.1.25-alpha.1) (2026-03-14)


### Features

* **cli:** integrate soop-mcp into soop mcp subcommand ([#228](https://github.com/pleaseai/soop/issues/228)) ([8dd7426](https://github.com/pleaseai/soop/commit/8dd74266ce1ca0065a5da91719e1dcb79903f897))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.1.11
    * @pleaseai/soop-mcp bumped to 0.1.12

## [0.1.24-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.23-alpha.1...soop-v0.1.24-alpha.1) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.1.10
    * @pleaseai/soop-encoder bumped to 0.1.10
    * @pleaseai/soop-mcp bumped to 0.1.11
    * @pleaseai/soop-tools bumped to 0.1.10

## [0.1.23-alpha.1](https://github.com/pleaseai/soop/compare/soop-v0.1.21...soop-v0.1.23-alpha.1) (2026-03-14)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.1.9
    * @pleaseai/soop-encoder bumped to 0.1.9
    * @pleaseai/soop-mcp bumped to 0.1.10
    * @pleaseai/soop-tools bumped to 0.1.9

## [0.1.21](https://github.com/pleaseai/soop/compare/soop-v0.1.20...soop-v0.1.21) (2026-03-12)


### Bug Fixes

* **soop:** update minimum Node.js requirement to 24 ([#198](https://github.com/pleaseai/soop/issues/198)) ([a4cffad](https://github.com/pleaseai/soop/commit/a4cffad23c31111e5049bda1e982f2e72cc2af10))

## [0.1.20](https://github.com/pleaseai/soop/compare/soop-v0.1.19...soop-v0.1.20) (2026-03-12)


### Features

* **soop-native:** split platform binaries into @pleaseai/soop-native package ([#194](https://github.com/pleaseai/soop/issues/194)) ([facd2ca](https://github.com/pleaseai/soop/commit/facd2ca62dd14cb9f5f53c305ea73f262e2b2ec8))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.1.8
    * @pleaseai/soop-encoder bumped to 0.1.8
    * @pleaseai/soop-graph bumped to 0.1.8
    * @pleaseai/soop-mcp bumped to 0.1.9
    * @pleaseai/soop-store bumped to 0.1.7
    * @pleaseai/soop-tools bumped to 0.1.8
    * @pleaseai/soop-zerorepo bumped to 0.1.8

## [0.1.19](https://github.com/pleaseai/soop/compare/soop-v0.1.18...soop-v0.1.19) (2026-03-12)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @pleaseai/soop-cli bumped to 0.1.7
    * @pleaseai/soop-encoder bumped to 0.1.7
    * @pleaseai/soop-graph bumped to 0.1.7
    * @pleaseai/soop-mcp bumped to 0.1.8
    * @pleaseai/soop-tools bumped to 0.1.7
    * @pleaseai/soop-utils bumped to 0.1.7
    * @pleaseai/soop-zerorepo bumped to 0.1.7

## [0.1.18](https://github.com/pleaseai/soop/compare/soop-v0.1.17...soop-v0.1.18) (2026-03-11)


### Bug Fixes

* **soop:** strip workspace devDependencies on npm publish ([#181](https://github.com/pleaseai/soop/issues/181)) ([c310452](https://github.com/pleaseai/soop/commit/c310452dbfe8dafa8d47a960466a8a43464da30c))

## [0.1.17](https://github.com/pleaseai/soop/compare/soop-v0.1.16...soop-v0.1.17) (2026-03-09)


### Features

* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))


### Bug Fixes

* add workspace dependencies to trigger release-please cascade bumps ([#175](https://github.com/pleaseai/soop/issues/175)) ([ce5ff56](https://github.com/pleaseai/soop/commit/ce5ff56938a97bee00662ba63fc2c09729606960))
* **build:** fix Bun.build compile API and add robustness to generate-packages script ([#131](https://github.com/pleaseai/soop/issues/131)) ([24e8609](https://github.com/pleaseai/soop/commit/24e86096ef0dac509d59417ad424e875eb31a4e9))
* resolve bun install -g failure and correct CI command name ([#135](https://github.com/pleaseai/soop/issues/135)) ([6af1dc3](https://github.com/pleaseai/soop/commit/6af1dc379ea4342922c193a3519188fc927e2225))

## [0.1.16](https://github.com/pleaseai/soop/compare/v0.1.15...v0.1.16) (2026-03-09)


### Bug Fixes

* add workspace dependencies to trigger release-please cascade bumps ([#175](https://github.com/pleaseai/soop/issues/175)) ([ce5ff56](https://github.com/pleaseai/soop/commit/ce5ff56938a97bee00662ba63fc2c09729606960))

## [0.1.15](https://github.com/pleaseai/soop/compare/v0.1.14...v0.1.15) (2026-03-09)


### Bug Fixes

* add workspace dependencies to trigger release-please cascade bumps ([#175](https://github.com/pleaseai/soop/issues/175)) ([ce5ff56](https://github.com/pleaseai/soop/commit/ce5ff56938a97bee00662ba63fc2c09729606960))

## [0.1.14](https://github.com/pleaseai/soop/compare/v0.1.13...v0.1.14) (2026-02-26)


### Features

* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))


### Bug Fixes

* **build:** fix Bun.build compile API and add robustness to generate-packages script ([#131](https://github.com/pleaseai/soop/issues/131)) ([24e8609](https://github.com/pleaseai/soop/commit/24e86096ef0dac509d59417ad424e875eb31a4e9))
* resolve bun install -g failure and correct CI command name ([#135](https://github.com/pleaseai/soop/issues/135)) ([6af1dc3](https://github.com/pleaseai/soop/commit/6af1dc379ea4342922c193a3519188fc927e2225))

## [0.1.13](https://github.com/pleaseai/soop/compare/v0.1.12...v0.1.13) (2026-02-26)


### Features

* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/soop/issues/117)) ([d4b805a](https://github.com/pleaseai/soop/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))


### Bug Fixes

* **build:** fix Bun.build compile API and add robustness to generate-packages script ([#131](https://github.com/pleaseai/soop/issues/131)) ([24e8609](https://github.com/pleaseai/soop/commit/24e86096ef0dac509d59417ad424e875eb31a4e9))
* resolve bun install -g failure and correct CI command name ([#135](https://github.com/pleaseai/soop/issues/135)) ([6af1dc3](https://github.com/pleaseai/soop/commit/6af1dc379ea4342922c193a3519188fc927e2225))

## [0.1.12](https://github.com/pleaseai/soop/compare/v0.1.11...v0.1.12) (2026-02-26)


### Bug Fixes

* **build:** fix Bun.build compile API and add robustness to generate-packages script ([#131](https://github.com/pleaseai/soop/issues/131)) ([24e8609](https://github.com/pleaseai/soop/commit/24e86096ef0dac509d59417ad424e875eb31a4e9))

## [0.1.11](https://github.com/pleaseai/soop/compare/v0.1.10...v0.1.11) (2026-02-25)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @pleaseai/soop-cli bumped to 0.1.4
    * @pleaseai/soop-encoder bumped to 0.1.4
    * @pleaseai/soop-graph bumped to 0.1.4
    * @pleaseai/soop-mcp bumped to 0.1.4
    * @pleaseai/soop-store bumped to 0.1.4
    * @pleaseai/soop-tools bumped to 0.1.4
    * @pleaseai/soop-utils bumped to 0.1.4
    * @pleaseai/soop-zerorepo bumped to 0.1.4

## [0.1.10](https://github.com/pleaseai/RPG/compare/v0.1.9...v0.1.10) (2026-02-25)


### Features

* rebrand from rpg to repo please with monorepo restructure ([#117](https://github.com/pleaseai/RPG/issues/117)) ([d4b805a](https://github.com/pleaseai/RPG/commit/d4b805abc23f20e8ac3fe1b375c105ba7a6c9b33))
