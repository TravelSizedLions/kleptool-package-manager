# Ordered TODO List

## 1. Foundational
- [ ] Revisit the introduction
- [x] Add a section explaining the decision to couple this toolset to git

## 2. Feature Engineering Foundations
- [ ] Add detail for calculating each feature and considering its viability in the heuristic
- [ ] Expand the dimension-wise normalization section with concrete examples of how normalization prevents search space bias in the configuration space
- [x] Add a section on median-score feature backfilling

## 3. Core Algorithm & Architecture
- [ ] Elaborate on edge handling and weighting in the graph representation, particularly regarding version change types
- [ ] Complete the "Alternative Initializations" section, detailing additional starting points for dependency resolution beyond manifest files
- [ ] Add a section on practical considerations for maintaining the configuration space
  - [ ] When to expand and cache?
  - [ ] When to invalidate?
  - [ ] Data-structure design
  - [ ] Updating median-scores
  - [ ] Handling missing/deleted hashes
- [ ] Add a section on practical architecture (performance, serialization, data passing)
- [ ] Outline the architecture once features are set

## 4. Feature Engineering & Scoring
- [ ] Detail the specifics of how repository health metrics are scored and weighted in the distance calculation
- [ ] Add a section explaining in more detail how semantic and non-semantic versions interact, and how they are scored
- [ ] Detail the CVE scoring mechanism and how security vulnerability weights are updated over time
- [ ] Add a section for planned evaluation (post-training synthetic, real world)
- [ ] Add a section on future considerations (models tuned for specific optimizations, early failure prediction, extensibility, non-primary branches, static assets)
- [ ] Expand the dataset acquisition section with specific handling strategies for non-semantic versioning repositories

## 5. Migration, Portability, and Interop
- [ ] Add a section with considerations on how to most easily address portability and lockfile/manifest translation
  - [ ] Core concerns: These files are extremely complex (especially the lockfiles)
  - [ ] Build/Compilation may be strongly coupled to the project's structure (as with languages like Go)
- [ ] Develop more immediate transition strategies for migration from existing package management systems

## 6. Visualization & Examples
- [ ] Add visualizations
- [ ] Add more examples throughout the mathematical notation sections to improve readability
- [ ] Create diagrams to illustrate the K-space configuration concepts
- [ ] Add concrete performance benchmarks and expected inference time impacts
- [ ] Document the data synthesis process more thoroughly, including specific examples of commit dropout and constraint mangling
- [ ] Add implementation details about the polyglot architecture and how the different language components interact

## 7. Refinement & Polish
- [ ] Revisit the section on applying A* and SMT together, removing incorrect references to finding "a" solution rather than an optimal one. 
