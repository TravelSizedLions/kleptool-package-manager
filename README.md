# Klep: The First Truly Language Agnostic Dependency Resolver

[![Ubuntu](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/linux.dev.yml/badge.svg)](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/linux.dev.yml)
[![Windows](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/windows.yml/badge.svg)](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/windows.yml)
[![Mac OS](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/macos.yml/badge.svg)](https://github.com/TravelSizedLions/kleptool-package-manager/actions/workflows/macos.yml)

![TypeScript Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/TravelSizedLions/YOUR_GIST_ID/raw/kleptool-ts-coverage.json) ![Rust Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/TravelSizedLions/YOUR_GIST_ID/raw/kleptool-rust-coverage.json)

# GUD: Git-Derived Unified Dependency Resolution

## Abstract

In this document, we'll rigorously explore the practical and theoretical challenges of implementing a language- and versioning-agnostic dependency resolver. We will discuss and analyze the development environments of a diverse set of languages and their large-scale and niche applications in order to understand their shared dependency resolution needs. After, we will devise a method for tackling this notoriously difficult problem using a novel formulation for translating dependency manifests into a unified representation, then proposing a resolution method by constructing an A* heuristic for dependability optimization. Due to the specific quirks of current solutions for dependency resolution and requirements for A* to reach optimal solutions, A* has a distinct theoretical advantage over SMT-based approaches, which we'll discuss. In short, this discourse will show that a purpose-built adaptation of A* leveraging a fully-connected feedforward network to fine-tune a traditional heuristic can be guaranteed to maintain monotonicity, and does not require maintaining admissibility in order to achieve similar results to SMT.

For those unfamiliar with this problem space and the background required to understand this methodology, I'll begin by reviewing well known development ecosystems and their similarities, differences, and challenges, then summarize the general principles, purposes, and requirements of A*, Neural Models, Unsupervised Learning, Abstract Syntax Trees and AST comparison algorithms, and SMT solvers, followed by a discussion of their synergies. Then, after establishing a common language and knowledge bases, we'll formalize the approach to unifying the dependency resolution process and end goals. After, we'll go on to discuss practical requirements for such a tool and hypothetical limitations, including:

- Building and maintaining the A* configuration space
- Gathering data reliably to train the heuristic and create a model for categorizing dependency manifests and resolutions into AST families
- Allowing for user insight into the manifest translation and resolution process, and direct intervention in unexpected cases
- The time and computational cost to cache and clone repositories
- Resolving non-semantic version targets together with semantic targets
- Architecting, initializing, training, and tuning a custom, locally deployable neural model
- Updating dependencies from partial solutions
- Recovering from expired or missing cached dependencies
- Extracting and normalizing disjointed project structures, and how such structures affect the implementation of the Neural A*-SMT resolver

We'll then use these considerations and others to discuss future work.

## Motivation

*There is no "Git, but for Package Management" yet, but there should be.*

If you are preparing to write:

- A python tool
- A web or mobile application
- A .NET application
- A Rust server
- Or something an unironic PHP enjoyer would want to write in PHP

Then you've already got a package ecosystem that suits your needs. Why would you ever use or need a package management system that isn't tailored to your language of choice?

This dismisses the realities of software development, both at an enterprise and individual level.

What if you're writing a tool in multiple languages? What if one or more of those languages have a small following and don't have a dedicated package manager or a community big enough or experienced enough to build one?

An experienced developer might respond that language agnostic dependency management tools like Gradle, Maven, and smaller ecosystems like Pants already make it possible to manage polyglot repositories. However, tools like this are almost always written with a specific language context in mind, then adapted to other languages later using community-driven plugins. While this approach "works," it has hard limitations on how universal these tools can actually be in practice.

In the case of a more modern general-purpose tools like Bazel, they're generally geared towards the needs of massive organizations and don't scale down well to smaller repositories and personal projects. For professional developers, they can ask "what's the problem?" To which I respond: Do you know what the term *general-purpose* actually implies?

In addition, nearly every tool has an over-reliance on semantic versioning. While SemVer is a major blessing for both enterprise and FOSS development, it's never guaranteed that a dependency needed for a project follows semantic versioning. Outside of mainstream enterprise development, a project may need build tools and libraries with release versions numbered by year and quarter, or that have a GUI interface under alpha development with a number of additional in-progress dependencies required to build the interface, not to mention your actual project. Other, smaller projects are dependent on repositories with no version scheme or official release process at all, and have no better alternatives due to lack of historical support. In all of these cases, target versions for a dependency are such comforting values as `v2021.3`, `v0.0.1-alpha`, `=sufjw0n9273lklksjf72kdfjsy8`, `feature/branch-experimental`, or my personal favorite, `latest`.

If you've run into this class of problem, then you know why we need a more universal answer to dependency management. The problem is so persistent and the thought of a solution so tantalizing that there's a decent chance you've considered writing a git-based package manager yourself. But the after the first few commits into such a project, most see why "the git of package managers" still doesn't exist. The list of practical problems to solve seems intractable for even the largest teams to crack, let alone someone who just misses `pip` while working on their MATLAB project at work. But to eventually reach that "git of package managers," we need to start chipping away at that list of problems and insist that there's a better way even the most dedicated research and development teams may not have considered.

### Case Studies

In order to understand the needs a universal package manager must solve, we should start from grounded observations. Below, we'll walk through over a dozen common languages and development scenarios to analyze, compare, and contrast their needs. These examples purposely cross boundaries of common industry circles and treat niche cases with the same level of scrutiny as more mainstream cases. This is done in the effort to gain deeper insights into the underlying patterns inherent to software development of all varieties.

#### Case Study #1: Godot

Most game engines come with either limited (and proprietary) dependency management or none at all. 

If there is a way to get and install dependencies:
- It's not recursive, and so has no concept of transitive or peer dependencies
- If it is recursively resolving, it doesn't effectively handle resolving version constraints on those transitive dependencies
- Or if they do, the packages that support these things are locked behind the paywall of a proprietary asset store

Yet many of these environments have a desperate need for solid dependency resolution outside of a closed ecosystem. For instance, Godot's otherwise-brilliant GDScript language and free asset store lacks namespacing, and so every named class in your project, addon or not, is *global.* Godot's asset store also contains a fraction of the assets that are actually available to all users of Godot through public remote repositories, and has no concept of dependency resolution, so mid-sized projects have one of four options:
- Manage every dependency and namespace collision themselves
- Use a tool like Gradle or Maven, which has no official support for GDScript
- Eschew dependencies entirely and implement everything their project needs from scratch
- Or switch to a language binding like C# or Rust which has marginally better tooling due to their pre-existing ecosystem.

In addition to this, most Godot projects are developed by at most a handful of individuals working part-time, and many useful dependencies end up coming from barely maintained projects. These projects and their dependencies typically don't follow any formal standard, let alone have official releases tagged with semantic versioning . This development context is useful, as it teaches us right out the gate that we can't rely on anything that most popular languages and package managers take for granted, such as global registries, semantic versioning, standard project structures, or isolated namespaces.

#### Case Study #2: Lua

According to the 2024 Stack Overflow Developer Survey, Lua was ranked the 16th most used language overall at 6.2% of respondents saying they either use the language professionally or are currently learning it, placing close in ranking to languages with much more mature ecosystems like Ruby (19th/5.8%), Rust (14th/12.6%), Go (13th/13.5%), and even sharing the top 20 with the venerable PHP (11th/18.2%). Lua is also one of the fastest growing languages, with 10% of programmers in 2024 learning to code with Lua (up from 6.97% in [2023](https://survey.stackoverflow.co/2023/#most-popular-technologies-language-learn)).

Despite this, Lua's built-in package manager is underdeveloped and its ecosystem under-served, having fewer than 6,000 available packages on its [official registry](https://luarocks.org/modules) as of June, 2025. Lua was first released in July of 1994, and so the likelihood of it ever being a strongly supported language like Javascript, Go, or Python is minimal.

In addition,  Lua is a language designed for and most commonly used in a multi-lingual context. Lua's niche is to provide a minimalistic but modern interface for writing extensions to existing applications and embedded systems. This means that much of the time, Lua must co-exist with other languages like C, C#, and Java within their ecosystem, without the built up support and documentation of these heavier hitting general purpose languages. From core developers' [own site](https://www.lua.org/about.html):

> Lua has been used in many industrial applications (e.g., Adobe's Photoshop Lightroom), with an emphasis on embedded systems (e.g., the Ginga middleware for digital TV in Brazil) and games (e.g., World of Warcraft and Angry Birds)....
>
> ...Lua runs on all flavors of Unix and Windows, on mobile devices (running Android, iOS, BREW, Symbian, Windows Phone), on embedded microprocessors (such as ARM and Rabbit, for applications like Lego MindStorms), on IBM mainframes, etc.

Here, we have a popular language where users of it are:

- Growing in number
- Commonly using it for non-modular, closed system solutions
- Limited in packaging options and standard libraries
- Using it specifically for its synergy with more popular ecosystems

#### Case Study #3: JavaScript

Unlike our first two case studies, JavaScript has difficulties on the opposite end of the dependency resolution problem. Rather than having little to no support, JS/TS is *over-supported,* to the point of fragmentation in the language's community. While most developers still source packages from the global NPM registry, the space has exploded with complexity, project bloat, poor quality packages, vulnerabilities, and competing standards, as the language itself has fragmented into multiple language specifications--all for a language which at its root was never originally intended for what it's used for today.

With a decades-long schism in package management systems for JavaScript, new tools such as yarn, deno, bun, pnpm, and others continue to re-solve the same core problems, and each have their distinct upsides and downsides:

- `npm`: The original and still most widely used, but notorious for massive node_modules folders, slow installs, and a history of security incidents

- `yarn`: Introduced to address npm's speed and determinism issues, but added its own lockfile format and quirks. Yarn v1 and v2+ are almost different ecosystems.

- `pnpm`: Aims to solve npm's node_modules bloat problem by using a content-addressable store and symlinks, but can trip up tooling that expects the traditional node_modules layout.
- `deno`: Created by the original author of Node.js, Deno ditches node_modules entirely and fetches dependencies directly from URLs, but this breaks compatibility with the vast npm ecosystem and requires a different mental model. Why did you do this to me, Ryan? Direct URL imports? Seriously? Did you really have to make this problem even harder, bro?
- `bun`: A newer, ultra-fast runtime and package manager, but still maturing and not yet as widely adopted or as stable as the others.

Each of these tools tries to fix pain points in the ecosystem, but the result is a development landscape where:

- Projects may require specific package managers or even specific versions of those managers.

- Lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml) are not interchangeable, making collaboration and migration between tools tricky.

- Some packages or tools only work with certain managers or certain versions, leading to "dependency manager lock-in."

- The sheer number of transitive dependencies in a typical project can number in the thousands, increasing the attack surface for vulnerabilities and making reproducibility a challenge.

On top of that, JavaScript's *flexibility-above-all* approach means that it's most popular package manifest, `package.json`, can be used in wildly different ways, and the ecosystem's rapid evolution means that best practices are constantly shifting. The result is a dependency resolution and build environment that's unwieldy for even experienced developers.

#### Case Study #4: Python and Virtual Environments

Python is the single most popular language in the world, and its tactics for dependency management and module importing are perhaps the most broken and convention-defying possible.

By default, Python searches for packages on the system globally, so individual projects may incidentally be relying on a system-wide package. This creates multiple problems:

- No guarantees that your project is properly isolated and reproducible
- Versions for dependencies may clash from project to project

The Python community's solution to this is *virtual environments*, or sandboxing individual projects by emulating a global install context.

Instead of gathering, installing, and labeling dependencies as project-specific within the root project folder, a virtual environment outside the project is defined in a shared folder of other python environments, and then packages are installed there.

To use an analogy, think of organization for house projects and chores. Most languages set up your project's needs right inside your house alongside where the actual work is being done. The sponges are by the sink, the tools for yardwork are in the shed out back, the plunger is in the bathroom, the laundry soap is by the laundry machines, and the baking supplies are in the fridge and pantry, with the mixing bowl and oven. Everything you need for the work is local to the place where the work is happening.

Python, on the other hand, hands you a key to a massive building outside of your home. Each time you need to do a project, you have to build a room in that building, put the supplies you need for that project in that room, and then temporarily bring the supplies home with you to do the work. It's so isolated that it isolates the dependencies from the project itself, which feels inside-out. It also leads to problems like trying to remember which environment maps to which project or set of projects. And speaking of which--virtual envs aren't a one-to-one relationship with projects, making them subpar for isolation, reproducibility, and portability.

This is beginning to shift to more traditional package management strategies with the advent of tools like poetry, but by default, it's still a hybrid approach of trying to create reproducible project dependency structures through a manifest, and storing the resolved and installed dependencies outside of the project itself.

However, standardized adoption for internal storage of project dependencies has seen pushback from Python's core development team. A [proposal](https://discuss.python.org/t/pep-582-python-local-packages-directory/963/430) for the introduction of a project-specific `__pypackages__` directory was recently rejected in March of 2023, citing concerns with backwards compatibility for existing workflows and project security. The result is similar to that seen in JavaScript's community: a schism in the ecosystem regarding dependency management and resolution, with no accepted universal approach and a hesitance to create one.

#### Case Study #5: Rust, Recursive Manifest Definitions, and Cross-Language Synergy

Rust is one of the newest and fastest-growing systems programming languages released in the recent past. It's a language whose package management and dependency resolution is held up as a gold standard among those who are familiar with it. It features first-class support for recursive dependency manifest structures with its workspace system, allowing for clean, isolated subsections defined within the context of a monorepo of libraries and executable binaries, called 'crates'. While other ecosystems offer similar solutions, the crates system takes advantage of its tight coupling with the language to offer a strong solution for pure rust repositories.

In addition, Rust's system for macros makes generating bindings for communication with higher level languages as simple as adding a function decorator (You should try it sometime--its web assembly bindgen system is delightful). And so, Rust often finds itself filling the role of handling low-level performance-critical code to hand back up to languages like Python and JS through bindings or ipc/rpc protocols. This purposeful consideration of Rust's own role as one piece in a greater system shows that building tools that allow for elegant cross-compatibility are not just possible, but synergistic. Rust's power as an expressive low-level language that plays well with scripting languages serves not just its own community, but that of any language dovetailing off of its strengths, similar to the symbiotic relationship of Lua and its embedded systems focus.

#### Case Study #6: Java, Kotlin, Gradle, and Maven

#### Case Study #7: C and C++

#### Case Study #8: Assembly and Machine Code

#### Case Study #9: Groovy

#### Case Study #10: MATLAB

Why include a language that's exclusively tied to a single GUI application?

Because it's tied to a single GUI application. 

MATLAB illustrates how ubiquitous the need for dependency management is. It's an interesting ecosystem to consider, because unlike most languages in this review of ecosystems, many users of MATLAB don't even consider themselves software engineers. Instead, they're often researchers dedicated to fields such as aerospace engineering, and don't generally have a need to deploy code they've written. However, MATLAB users still share many of the same problems as more common languages and development contexts when it comes to sourcing and resolving dependencies and re-using 3rd party code. 

MATLAB uses "toolboxes"  to describe it's version of libraries. There's no mainstream package manager and there isn't much by the way of packaging or distribution. It's not at all uncommon for MATLAB users to *email zipfiles* to coworkers in order to share their own code or code taken from 3rd parties, and collaboration is typically limited to single research teams.

Similar to the circle of game engines and games development, the MATLAB IDE has as of April 2020 added an [addons explorer](https://www.mathworks.com/videos/add-on-explorer-106745.html) where developers can browse for and install verified third party toolboxes. The alternative to using this proprietary solution is to browse for privately curated collections of toolboxes on sites like GitHub ([example-1](https://github.com/Matlab-Toolbox),  [example-2](https://github.com/mikecroucher/awesome-MATLAB),  [example-3](https://github.com/gpeyre/matlab-toolboxes)) and manage installing the toolboxes yourself. However, the size, quality, and maintenance status of both the collection and its individual constituents isn't guaranteed.

An additional complication that's common to other languages is upgrades to MATLAB itself. Version upgrades of MATLAB's IDE and language can introduce breaking changes that go undeclared, and that invalidate existing versions of libraries. On top of this, MATLAB does not use semantic versioning in its own releases. This means that, just like more traditional languages, even MATLAB would stand to benefit from a system in which users can define dependencies and request particular versions of them.


### Patterns and Takeaways



### Searching for a Better Wheel

We in the development community have a problem: the \*.wheel keeps getting re-invented for specific languages, often  in a limited capacity. Yet the approach is always roughly the same for every major package manager: 

- build a public source for packages to be published
- enforce versioning on those publishes
- enforce directory structures
- enforce tooling
- resolve dependencies with SAT solvers
- \*.lock resolved versions in place.

Despite the approach always being similar, no-one's sought to actually, *fully* solve the general case problem of dependency management, i.e., for all project structures, sources, versioning schemes, and languages. 

Both the industry and the individual stand to benefit from a general purpose solution to package management and dependency resolution, one that can handle complex or non-ideal development environments at both small and large scale. The potential benefits that would come from a language and versioning agnostic dependency resolver are numerous:
- No more need for dedicated package stores
- No need to re-learn CLIs and tooling when hopping from language to language or project to project
- Support for semantic version tags when they exist, and other schemes when they don't.
- Greater precision in resolving dependencies are needed for each project, down to individual commits if necessary.
- Automatically filtering out or avoiding versions based on CVE records
- The capacity to work with and standardize non-standard project layouts in your dependencies

## Goals

The purpose of this document is to outline an alternative to language-specific and semver-dependent package management. It does not attempt to broach other aspects of a language-specific ecosystem, such as compiling, transpiling, bundling, hosting, or distributing code artifacts. Instead, this proposal is purposely scoped down in order to create a single, unified solution for dependency management, with inspiration taken from multiple off-the-shelf approaches to common problems in development. It aims to outline a path towards creating the `git` of package management.

### What Would the "Git of Package Management" Look Like?

- ***Language-agnostic:*** Works for any language, any project structure.

- ***Versioning Ambivalent:*** Leverages semantic versioning schemas where they exist, but doesn't require them to incorporate or resolve dependencies.

- ***Efficient and Safe:*** Minimizes risks from transitive dependencies, and does so *fast*

- ***Decentralized:*** No single point of failure or central registry required.

- ***Reproducible:*** Guarantees you get the same dependencies for the same specified requirements, every time, everywhere.

- ***Composable:*** Lets you mix and match dependencies from any source (git, registries, local, etc.).

- ***Minimal Friction:*** Easy to adopt, no need to rewrite your project or learn a new DSL.

## Background

### A Review of Existing General Purpose Development Ecosystems
- Gradle: Geared heavily towards android app development
- Maven: Geared towards java development
- Pants:
  - Simple
  - Tailored towards monorepos
  - Language-specific needs implemented using the same API as their plugins
  - Smaller Community
  - Simplicity breaks down when learning advanced features
  - Aims most specifically towards python, though there is definitely support for other languages
  - Difficulty scaling on enterprise-sized monorepos
- Bazel
  - Highly scalable, geared specifically towards massive polyglot monorepos
  - High learning curve
  - First-class support for the most common languages
  - Implements sandboxing of its resolver to guarantee build reproducibility
  - Large ecosystem
  - Lacking in Python support
  - Opinionated
  - Too complex for small projects
  - Google-centric defaults
- Buck: Deprecated
- Nix: platform-specific, not a built as a project management system by default (though it can be used to set up reproducible project environments)

### Related Research

Disorganized, WIP: read, rank, and discard unrelated/out of scope research

 - Learning to Solve SMT Formulas (FastSMT) - Balunovic et al., 2018
 - Smart Pip https://dl.acm.org/doi/abs/10.1145/3551349.3560437
 - Automatic CVE detection and resolution: https://dl.acm.org/doi/abs/10.1145/3475960.3475985
 - Correlation between python version constraints and package incompatibility: https://www.sciencedirect.com/science/article/abs/pii/S0167642324000212
 - B.S Thesis on BDD Rust Dependency Resolution: https://oparu.uni-ulm.de/server/api/core/bitstreams/d5255729-14fe-4c67-98aa-a4eaa041302f/content
 - Maven Code Smell resolution: https://netlibrary.aau.at/obvuklhs/content/titleinfo/9718725/full.pdf
 - ML Security Considerations in the Future: https://dl.acm.org/doi/full/10.1145/3708533
 - Analysis of dynamic symmetries for SAT/SMT solvers: https://theses.hal.science/tel-03128926/
 - proposal of several dependency resolution approaches: https://dspace.library.uvic.ca/server/api/core/bitstreams/08e884a4-fccf-4fdd-88f3-121121ba0db4/content
 - Definitely Read & Cite this one: Literature Review of General-case dependency resolution (and why we lean towards SAT solvers): https://ieeexplore.ieee.org/abstract/document/9054837 (Feb, 2020)
 - 

### The A* Algorithm


The A* algorithm finds the optimal path between two nodes in a graph by maintaining two sets of nodes and using a scoring function to evaluate potential paths.

#### A* Algorithm Steps

1. Define two ordinal sets of nodes:
   - $Q_{open}$: Open queue (nodes to be evaluated)
   - $Q_{closed}$: Closed queue (evaluated nodes)

2. Define a scoring function:
   - $score(n) = \delta(n) + h(n)$
   - where $\delta(n)$ is the cost from $n_{start}$ to node $n$
   - and $h(n)$ is the heuristic estimate to $n_{end}$

3. Initialize:
   - Place $n_{start}$ into $Q_{open}$

4. Main Loop (while $Q_{open} \ne \emptyset$):
   1. Find node $q$ with minimum score in $Q_{open}$
      - $q: \forall n_i \in Q_{open}, f(n_i) \ge f(q)$
   2. Remove $q$ from $Q_{open}$
   3. For each connected successor node $s$ of $q$:
      - If $s \in Q_{closed}$, skip
      - If $s = n_{end}$:
        - **Stop search**
        - Reconstruct path from $n_{end}$ to $n_{start}$ using linkbacks
        - Return this path
      - Otherwise:
        - If $\exists n \in Q_{open}: score(n) \le score(s), n \ne s$, skip
        - If $\exists n \in Q_{closed}: score(n) \le score(s), n \ne s$, skip
        - Otherwise:
          - Add $s$ to $Q_{open}$
          - Link $s$ back to $q$
   4. Add $q$ to $Q_{closed}$

5. If loop exits without finding path:
   - **Return failure** (No path exists from $n_{start}$ to $n_{end}$)

### Satisfiability and SMT

#### Boolean Satisfiability (SAT)

Satisfiability describes a problem space where the goal is to determine if a given set of boolean clauses can be resolved to TRUE. These clauses are typically given in Conjunctive Normal Form (CNF), which is a normalized form where clauses are ANDed together, and each clause is a disjunction (OR) of literals. For example:

$$
(\neg x_1 \land y_1 \land \neg z_1) \lor
(x_2 \land y_2 \land z_2) \lor \dots  
\lor (x_n \land y_n \land z_n)
$$

This is known as 3-SAT because each clause contains exactly three literals. The problem asks: "Is there an assignment of TRUE/FALSE values to the variables that makes the entire expression TRUE?"

#### Satisfiability Modulo Theories (SMT)

While SAT deals with pure boolean logic, SMT extends this by allowing more complex predicates. Instead of just boolean variables, SMT can work with:

- Arithmetic constraints ($x + y > z$)
- Array operations ($array[i] = value$)
- Bit-vector operations
- String operations
- And more...

For example, an SMT problem might look like:
$$
(x > 5) \land (y < 10) \land (x + y = 15)
$$

The key difference is that SMT solvers can reason about these more complex predicates while still using SAT-solving techniques at their core. This makes SMT particularly useful for:

1. Program verification
2. Model checking
3. Test case generation
4. And, in our case, dependency resolution

#### Why This Matters for Dependency Resolution

In dependency resolution, we can frame our constraints as SMT predicates:

- Version compatibility: $version(dep1) \geq required\_version$
- Conflict avoidance: $\neg (version(dep1) = version(dep2))$
- Feature requirements: $has\_feature(dep, feature) = true$

The SMT solver can then find a satisfying assignment that meets all these constraints, effectively finding a valid set of dependency versions. Many existing solvers use sophisticated heuristics, backtracking with contradiction memory, and 

## SMT and A* Heuristic Dependency Resolution

To solve a problem like dependency resolution, the question becomes "Can I find a set of dependency versions that won't break the consumers of those dependencies and also do not conflict with one another?"

Thankfully, this is exactly the kind of problem SMT and Semantic Versioning was designed to solve.

Except…It's not. Not quite.

### The Problem of Recursion in Search-Spaces

There's a complication to finding a set of dependencies whose versions do not conflict with one another and satisfy the needs of their consumers, and that complication is *recursion*. **Because dependencies can add and remove additional dependencies from version to version**, there's no telling what dependencies actually need to be installed for a given version ahead of time.

This creates a chicken-and-egg scenario:
1. To know what dependencies we need, we need to know the versions
2. To know the versions, we need to know what dependencies we need

In addition, recursion opens up the possibility of cyclical dependencies.

### Combining SMT and A*

Thankfully, while "Can I find a set of X,Y,Z that fits my needs A,B,C?" is the only kind of problem SMT cares about solving, algorithms such as A* only cares about solving "What's the best thing to do and how do I do it?" kind of problems—in other words, optimization problems. 

Since the actual question behind dependency resolution is "How do I find a set of dependencies that satisfy constraints when I don't know what all of the dependencies are ahead of time?", that implies the answer is some amalgamate algorithm of the two approaches.

#### How It Works

1. **A* Explores the space of possible dependency graphs**
   - Each node represents a potential dependency state
   - Edges and edge distance represent version changes and other time/risk costs
   - The heuristic estimates how close we are to a valid solution
   - The full cost function considers version compatibility

2. **SMT Validates Solutions**
   - When A* finds a potential path
     - SMT checks if it satisfies all constraints
     - If not, A* continues searching
     - If yes, we've found a potential solution

### Example Scenario

Consider resolving dependencies for a project:

1. Start with known direct dependencies
2. A* explores version combinations
3. When a new dependency is discovered:
   - Add it to the SMT constraints
   - Update the search space
   - Continue exploration
4. Repeat until a valid solution is found

This approach gives us the best of both worlds:
- SMT's ability to validate complex constraints
- A*'s ability to efficiently search large spaces

### Why use A* and an SMT solver together to search for satisfying dependency resolutions?

Modern dependency resolvers use exclusively SMT satisfiability solvers to reach a valid set of dependencies. While this works, it comes with a few limitations:

- SMT solvers are designed to find *'a'* solution, rather than an optimal or particularly desired one.
- SMT solvers use static, predefined heuristics to prune the search space of possibilities. This is for the sake of efficiency rather than optimization
- Even the best solvers for dependency resolution make the assumption that they will be handed semver-compliant version schemes.

A* on the other hand, offers:

- The same heuristic search space pruning approach, but with room for customizability and tunability
- No assumptions about the nature of the search space other than the requirement that it be expressed as a graph with a defined start state and goal to reach.
- Not just finding a valid solution, but finding the best solution for the distance and heuristic functions it's handed.

As such, A* offers an advantage when building an adaptive dependency resolver designed to minimize the risks inherent to added dependencies, while not insisting that all candidates adhere strictly to semantic versioning. If the dependency resolver itself can assess and minimize risks, SemVer as a standard is no longer a strict necessity to acquire safe, dependable packages and addons, and we make it possible to fine-tune resolutions for desired goals, such as:

- Automatically limiting or even outright preventing vulnerable transitive dependencies
- Limiting the number of installed transitive dependencies in the first place
- Finding resolutions closer to the specified or otherwise optimal target versions.
- Improving search heuristics over time (as we'll discuss later)

However, our algorithm will still need to verify that candidate solutions do in-fact satisfy the constraints placed upon them, and so SAT validation will still be used to validate the proposed solutions.

Conveniently, A* also gracefully handles cases where no dependency resolution can be found.

## Formally Defining the Configuration Space

As mentioned above, the configuration space for this problem is the set of all possible version configurations given a set of dependencies. In order to formulate this as a graph suitable for A*, we must define what constitutes the following:

- The dimensions in the space
- A node in the graph representing the space
- What is considered being the *successor* of another node and how we traverse from one configuration to another
- Our starting and ending nodes

So let's explore.

### Dimensions in the Space

Our goal is to define a vector space $K$ to adequately represent the space of possible configurations for a dependency graph.

A single dimension $K_i$ in the space of possibilities (where $K_i$ is the $i^{th}$ dimension in $K$ ) is the finite, time-ordered set of commit hashes of a single git repository. Incrementing and decrementing from hash to hash within a repository, we see changes in the repository contents and therfore in its dependency requirements. This yields the following properties for each enumeration $j$ within the dimension:

- The time-ordered hash $t_{i_j}$, which is unique within the repository's dimension
- The ordinal set $d_{i_j}$ of dependencies on other dimensions, which are edges to other dimensions in space
- The associated ordinal set of constraints $c_{i_j}$ on $d_{i_j}$ that are the acceptable hash values of each dependency

So the range of each dimension $K_i$ describes the following about a particular repository:

- A set of possible dependencies $D_i= \bigcup_{j=1}^{m} d_{i_j}$
- A a set of possible constraints on those dependencies $C_i = \bigcup_{j=1}^{m}c_{i_j}$
- A time-ordered set of hashes $T_i=\bigcup_{j=1}^{m}t_{i_j}$
- A function $\delta_i(j) \rightarrow (t_{i_j}, d_{i_j}, c_{i_j})$ mapping $t_{i_j}$ to its tuple of related ordinal sets $d_{i_j}$ and $c_{i_j}$
  - For example: $\delta_i(5)$ returns the hash, dependencies, and constraints for the 5th commit in repo $i$


In a localized range of hash values within a dimension, the number of dependencies and constraints for one hash is not strictly required to be close in number to its neighboring hashes. One hash may add 0 dependencies, 1, or 20, or remove all dependencies--along with anything in-between. However, there's an *a priori* expectation that the number of dependencies in a repository will trend upwards over time (though again, this is not guaranteed). Therefore, "higher" or rather *later* hashes in the dimension will also have more constraints than earlier values.

Since:
 - The number of repositories in $K$ is effectively infinite
 - The number of valid commit hashes in each repository is not the same
 - The number of dependencies and constraints for each commit in each repository is non-deterministic within local ranges of each repository's corresponding dimension

 Then the vector space of possible configurations for a dependency graph is the following unbounded, non-uniform, non-convex topology:

$$
K = \bigcup\limits_{i=1}^{\infty}\left\{\bigoplus\limits_{j=1}^{\lvert\lvert K_i \rvert \rvert} (t_j, d_j, c_j)\right\}
$$

Or:

$$
K = \{
  [
    (t_{i_j}, d_{i_j}, c_{i_j}) 
    \vert 
    j=1\dots \lvert\lvert K_i \rvert\rvert
  ]
  \vert
  i=1 \dots\lvert\lvert K \rvert\rvert
\}
$$

In other words, the configuration space is the set of all possible combinations of commit hashes (and their associated dependencies and constraints) across all repositories.

## Bounding K-Space
In practice, not all repositories that exist are needed as dependencies for every project (though seeing such a project would be entertaining)<sup>[citation needed]</sup>

This means that to resolve the dependencies for any given repository, we only care about a specific subspace of $K$—namely, the part that includes just the dependencies (and their dependencies, and so on) that are actually relevant to our project. In other words, we want to "zoom in" on the part of $K$ that matters for $K_i$ and ignore the rest of the infinite space of possibilities.

Let's formalize this idea for use later:

- As mentioned above, for each $K_i$, we have
  - $T_i$ the set of all commit hash values $t_{i_j}$ in $K_i$
  - $D_i$, the set of all dimensions reachable from $K_i$ through all dependency sets $d_{i_j}$ in $K_i$. This is also known as the dependency closure of $K_i$
  - $C_i$, the set of all sets of constraints on $D_i$ from $T_i$.

- For each $K_d \in D_i$, let $T_d'$ be the set of hashes in $K_d$ that are possible given the constraints induced by traversing from $K_i$.
  - ***Note:*** 
    - $T_d'$ is the set of time-ordered commit hashes in $K_d$ allowed by the currently active constraints in this resolution, where those constraints are imposed by the dependency graph rooted at $K_i$.
    - $C_i$ is the set of all possible sets of constraints that $K_i$ could ever impose on its dependencies, across all its hashes. 
    - In other words, $C_i$ describes the universe of possible requirements $K_i$ might have for its dependencies, while $T_d'$ is the set of versions of $K_d$ that actually satisfy the piecewise dependency constraints currently in play for a given commit hash $t_{i_j} \in T_i$.


Then the subspace of $K$ constrained for a given $K_i$ is the finite, non-uniform, non-convex configuration space:

$$
K_i' = \prod_{K_d \in C_i} T_d'
$$

Or, more explicitly,  $K_i' = \left\{ (t_d)_{K_d \in D_i} \;\middle|\; t_d \in T_d',\ \forall K_d \in D_i \right\}$


### Example
Suppose $K_i$ depends on $K_a$ and $K_b$, and $K_a$ depends on $K_c$. Then $D_i = \{ K_i, K_a, K_b, K_c \}$, and the subspace $K_i'$ is all possible assignments of hashes to these four repos, subject to the constraints that come from the initial dependency relationships imposed by $K_i$.


## Unifying Representations of K-Space

In the wilds of package management, every ecosystem invents its own flavor of manifest and lockfile, each with its own quirks, assumptions, and deeply held opinions about how dependencies should be described. Most package managers start with strong coupling to a specific language, then bolt on a plugin system to  meet the definition of "flexible" while leaving the work of translation to other language contexts largely up to community interest.

However, this approach has several severe weaknesses that make it unsuitable for a truly language agnostic tool:

- The likely need to refactor underlying systems as new requirements are discovered when porting over functionality to other languages. This increases the risk and/or necessity of making breaking changes and affecting the existing userbase while likely creating technical debt that can slow down or bloat the toolset over time
- If the plugin system is not created during the tool's initial design, languages after the initial language will inevitably be treated as second class.
- Backfilling support for existing language ecosystems means most will never see any support at all
- As new languages and approaches are released, the backlog of work continues to grow, making the work intractible and stunting adoption.

Instead, we propose taking a less direct approach: structural inference.

Rather than relying on a hardcoded list of known manifest formats and mapping them to a specialized, heavy duty, high risk, and heavy maintenence tooling dependency, a language-agnostic system must be able to *infer* the structure of an unknown manifest or lockfile by analyzing its shape, not just its surface details. 

This section is dedicated to exploring possible approaches to achieving a more adaptive dependency syntax translation system.

### Recursive Dependency Manifests: K-Space Constellations

In theory, the subspace $K_i \in K$ is a unified graph structure. However, in practice dependency manifests can be recursively defined in a project structure, dividing the graph up into logical chunks. Language specific package managers such as Rust's crate system are a prime example. Here, subsections of a repository may contain more than one crate, and therefore more than one Cargo.toml dependency manifest file, outlining parent/child and sibling relationships from some regions of $K_i$ to others. Practically speaking, when translating $K_i$ into a standard representation, these logical chunks and their implicit and explicit relationships must be preserved to avoid breaking existing project requirements.

(TODO: expand)

### Automated AST Translation Inferencing at a High Level

#### 1. **Parse to an Intermediate Structure:**

Load the manifest or lockfile into a generic data structure (e.g., parse JSON, YAML, TOML, XML, or even INI into a tree or map).

#### 2. **Abstract Syntax Tree (AST) Generation:**

Convert the intermediate structure into an AST, capturing the hierarchical relationships and data types present in the file.

#### 3. **AST Family Identification**

Use unsupervised techniques to analyze the AST and identify likely dependency blocks, version constraints, and sources.

AST family comparisons are performed

- The algorithm decides which cluster or "family" of AST structure the particular instance belongs to, identified from a prior training on a large corpus of manifests

Possible approaches include:

- **Tree similarity:** Compare subtrees across many manifests to find recurring patterns we can identify as the dependency manifest or resolution structure
  
- **Tree edit distance / subtree isomorphism:** Quantify how similar two trees (or subtrees) are, even if the keys differ.

- **Embedding techniques (e.g., tree2vec):** Represent ASTs or subtrees as vectors in a latent space, then cluster or compare them to find common structures.

#### 4. **Universal AST Family Transformation is Calculated**

Once the input's AST family has been identified, additional unsupervised comparisons are made to plan a translation from the existing AST family to the Universal K-Space family.

This is done through a combination of meta-structural analysis on patterns identifiable between AST families as well as an exploration of a space of statically defined AST refactoring strategies (inspiration taken from row-reducSome formats are ambiguous by design (e.g., fields that can mean different things depending on context, or keys that are overloaded for multiple purposes)tion operations and boolean clause manipulation).

We propose mapping the AST Family Transformation Problem onto a satisfiability or constraint-solving problem: given a set of allowed tree operations (renames, moves, merges, splits, type coercions, etc.) and a set of structural constraints defining the universal schema, a solver searches for a sequence of operations that transforms the input AST into one that satisfies all constraints.

The information gleaned from step 3 (AST family identification) can be used to constrain the search space for the solver, focusing only on the most likely or relevant operations for that family and improving efficiency.

- **Example 1: Key Name Normalization**
  - If step 3 identifies the AST as belonging to an "npm-like" family (e.g., `package.json`), the solver can focus on keys like `dependencies`, `devDependencies`, and `peerDependencies` as likely candidates for dependency blocks. Instead of searching the entire tree, it can prioritize renaming or mapping these keys to a universal `dependencies` field, tagging them with a type if needed. This reduces the risk of misclassifying unrelated fields and speeds up the transformation.
- **Example 2: List vs. Map Structure**
  - If the AST family is "list-based" (like Python's `requirements.txt` or Rust's `Cargo.toml`), the solver can skip unnecessary map-to-list conversions and focus on extracting dependency names and version constraints from list elements. For "map-based" families (like npm), it can do the reverse. This ensures the transformation is direct and avoids unnecessary restructuring.

Care must be taken to preserve important distinctions (e.g., dev vs. prod dependencies, peer dependencies, etc.) and avoid destructive operations that could lose information. Multiple satisfying transformations may exist; ranking heuristics or minimal edit distance can be used to select the best one.

#### 5. **Universal AST Translation is Applied**

Extract the minimal set of information needed for K-space:

- Dependency name
- Version constraint
- Source/repo (if specified)
- Optional: type (dev, optional, peer), if it can be inferred.
- Map these to Klep's universal representation, ready for dependency resolution.

#### 6. **The Translated AST is mapped back to Universal K-Space**

The Standardized AST resulting from 5. is translated back into a standardized format and exported for review.

### Differentiating Core Dependencies from Optional Dependencies

TODO

### Why Structural Inference?

- **True Language Ambivalence:** By converting manifest and lockfiles to ASTs and using unsupervised techniques, we remove layers of unimportant language-specific detail to get to identify the structure we care about.
- **Cross-language Clustering:** Some formats, such as those specified in javascript-centric package management system, are likely to end up in the same AST family
- **Future-Proof:** As new languages and package managers emerge, Klep can handle them with minimal updates. If new families are discovered, the AutoAST Translator can be re-trained without extensive hard-coded mappings.
- **User-Friendly:** Most users just want their dependencies resolved, not a deep dive into manifest archaeology. Structural inference keeps the magic behind the curtain.

### Limitations

While structural inference and constraint solvers can automate much of the translation process, it's not a silver bullet. For truly novel or highly custom formats, some human guidance or heuristics may still be required. The aim is to minimize the need for manual intervention as new languages and ecosystems emerge.

In addition, this approach (and this paper) is targeted towards specifically dependency resolution, rather than build support, bundling, or other jobs frequently built-into language-specific package managers.

### TODO: Open Questions & Next Steps

- How robust are current tree similarity and embedding techniques for this kind of heterogeneous, real-world data?
- What's the best way to handle ambiguous cases—should Klep prompt the user, or just make its best guess?
- Can we build a feedback loop, so user corrections help improve future inference?


## The Graph Representation of Bounded K-Space

### Nodes
In our limited configuration space $K_i'$, a single point in the space represents one possible dependency graph, represented by a set $\mathbf{k} \in K_i'$ in which each element is one hash from each dependency needed by the repository.

### Edges

As mentioned [above](#dimensions-in-the-space), each point $t_{i_j}$ in a dimension $K_i$ comes with two sets associated with it: the set of needed dependencies $d_{i_j}$ and the set of version constraints on those dependencies $c_{i_j}$. A value in the dependency set $d_{i_j}$ represents a connection from the dimension $K_i$ to another dimension $K_d \in D_i$ with $K_i \ne K_d$. However, this graph relationship is describing the connections of the dependency graph that each node $\mathbf{k}$ represents.

To understand edges in the graph of $K_i'$, we also need to define what constitutes the neighborhood of a node $\mathbf{k}$. If $\mathbf{k}$ is a single node in the graph $K_i'$, then $\mathbf{k}$'s neighbors are nodes in $K_i'$ which are only one step away from $\mathbf{k}$ in a single dimension. In practical terms, neighbors of $\mathbf{k}$ have a difference of one hash, either the one immediately prior to or immediately succeeding the commit specified by that repository's dimension in $\mathbf{k}$.

[jerrod]
Important Thoughts on neighbors!!

If the above paragraph is true, then the upper bound on the branching factor for each node is (2x <the number of dependencies>)

That...is not good. And that's before considering the fact that `extract` rules in the dependency schema mean that a single repository can spawn more than one dependency.

...Oh, hold on...that might be a vector for optimization. We can potentially de-duplicate dimensions by merging their extract rules. I think I remember considering this quirk when mapping out the lockfile schema...
[/jerrod]

## Application of A* on Bounded K-Space

For an implementation of A* to search through the $K_i$

### The Initial Configuration

The A* Algorithm calls for an initial configuration to place on its open queue (See the [algorithm steps](#a-algorithm-steps)).

In modern software package management systems, the list of root dependencies of a project are specified in a manifest. These specified target versions conveniently serve as a A*'s starting node $n_{start}$. While the root dependencies in these types of manifests do not include all possible repositories serving as dimensions of $K_i'$, this is remediable by following the cascade of transitive dependencies until we fill out the initial configuration. Any remaining dimensions in $K_i'$ not intialized by this process are *possible* transitive dependencies that may not be explored during dependency resolution.

#### Alternative Initializations

As one key feature of dependency resolvers is the caching and reusing of partial resolutions, initialization should also weigh a variety of other possible starting places for a candidate graphs based on previous resolutions. (TODO - add to this more later as I explore)

### The Solution Set
Formally, a point in the subspace $K_i'$ is a tuple $\mathbf{k} = (k_d)_{d \in D_i}$, where each $k_d \in T_d'$. A tuple $\mathbf{k}$ in which all constraints are satisfied for the root dependencies of the project represents a valid assignment (i.e., a candidate dependency graph) in $K_i'$. This makes $K_i'$ the search space of possible dependency resolutions for repository $K_i$. However, not every assignment of $\mathbf{k}$ is a valid dependency resolution, since not every $\mathbf{k}$ satisfies the constraints applied by dependencies in $\mathbf{k}$ for other dependencies in $\mathbf{k}$. 


To reach the solution set of valid dependency graphs, values for each dimension in $\mathbf{k}$ must satisfy the constraints posed by each other dimension of the assignment:

$$
\mathcal{V_i} = \{ \mathbf{k} \in K_i' \mid \mathbf{k} \text{ satisfies all constraints applied by values in } \mathbf{k} \}
$$

However, we're not happy just finding any member of this set. A* is designed to find an optimal solution.

### Optimality

What makes a dependency graph "optimal"? To start with, we have a few hard requirements:
- Satisfaction of the actual version constraints defined by the root dependencies
- No version conflicts
- No breaking changes
- Reproducibility

A few considerations to improve on these bare minimum requirements include:
- Minimizing Security Risk: no or minimal known security vulnerabilities
- Minimizing Future Instability: avoids adding transitive dependencies that are more likely to introduce breaking changes in the future
  - For example: avoiding transitive dependencies below semantic version 1.0.0 or which are otherwise relatively new and untested
- Minimal bloat: Adding the least number of added transitive dependencies
- Maximizing License compatibility: avoiding transitive dependencies with either no or incompatible licensing
- Community Health: avoid adding transitive dependencies which are poorly maintained if possible

At the risk of sounding cheeky, the most optimal dependency graphs are quite literally the graphs containing the most dependable dependencies.

The true question is more about finding the balance between these considerations, though that discussion will be covered in a later section.

### Distance

The distance between values of $\mathbf{k}$ is where we begin to re-enter the realm of practicality. For a real life implementation of an A* Neural Resolver, the cost factor of exploring one node in the configuration space over another could include multiple factors. As such, we need to employ a careful selection of features for our distance function, as these features will be reused as the basis of our guidance heuristic.

#### Feature Trustworthiness

Some metadata such as the number of downloads of the source, number of forks or watches, number of open or resolved issues appear to be useful for our heuristic at first glance. However, site-specific information like this comes with issues which cast doubt on their reliability:

- Inflated download counts due to automated install scripts (e.g., via CI/CD)
- The ability for maintainers to open and close issues at will, or fork their own code.
- Favorites or watches, even if available for all remotes, would not be like-for-like comparable, since not all sources for a remote will have the same global popularity.

For this reason, we chose to favor features that can be gathered directly from git in addition to a few relevant, well defined, industry trusted datasets, and explicitly aim to avoid the use of dedicated web scrapers or other site-specific data collection. This has the triple benefit of 

1. Making our features directly comparable between repositories, regardless of the remote the source is hosted on
2. Simple to acquire
3. Tautologically representative of features available to the algorithm in a realistic environment.

#### Feature Availability

In practice, repositories can be messy or ill-maintained. Even in cases were a repository is generally well maintained, not all features we would like to inspect for the sake of our distance calculation are going to be available. To maximize the number of features we can use to understand the dependability of the repository while not explicitly punishing repositories for missing metadata that may not be critical, we use the median value of the metric in question taken over the whole of the active configuration space to backfill the missing data.

#### Candidate Distance Features

##### CVE/CVSS

- What's the change in risk?
  - Does the new version have known security vulnerabilities?
  - Does the new version have known breaking changes?
  - Does the new version have transitive dependencies that need to be cloned or additional commits to be pulled?
  - Are all dependencies in the new configuration compatible with the license of the project?
  - Does this commit/project have a high/low CVE CVSS score? Or incorporate a number of CVE-laden transitive dependencies?

##### Strictness

How restrictive are the constraints on the new version compared to the existing version?

- Wider constraint ranges mean searching through more transitive dependencies for a candidate.
- Smaller constaint ranges mean less space to search, but provides fewer potential opportunities for optimization

##### Affect on the Dependency Graph

- How does the neighbor affect the dependency graph?
  - How many new transitive dependencies are added and/or removed?
  - Do the added/modified transitive dependencies contain riskier requirements or safer ones? Do removed transitive dependencies reduce the number of risky requirements?

##### Scale of the Change

How big is the change in actual code from one commit to the next?

- number of bytes in the diff
- number of lines in the diff 
  - added
  - removed
  - changed
- number of files added/removed/changed

##### Commit Documentation

- Is there a tag?
- Quality of the commit message
- How big is the change from one version to the next?
  - Major > Minor > Patch > Meta (as in meta information appended to the tag such as `rc1`, `alpha`, and `beta`), and single commit differences are closest of all

##### Commit Freshness

- Maintenence Status of the dependency

  - When was the last commit or tagged version of this dependency?
  - How often on average are changes made to this dependency, and how big are they?

### Modeling the Heuristic

When describing this project to a colleague of mine, he was fascinated by the proposition of using A* to search the space of dependency configurations for an optimal graph, however I was hesitant at first to mention the use of Machine Learning as a means of determining the heuristic.

Eventually, though, asked him point blank what his opinion was of using neural modeling for the heuristic function. He had several concerns, though his immediate and primary concern was that of guaranteeing a deterministic solution, as well as finding examples that can be labeled for supervised training.

#### Observations
For traditional dependency resolution, the goal is to find one of potentially several sets of versions for dependencies which satisfy all constraints put in place by all sources in the space.

Here, our goal is to instead balance the optimization of several factors, including:

- Picking versions that minimize the risks posed to the root project
- Resolving quickly
- Minimizing the number of dependencies overall
- Staying relatively close to the user-specified target version
- Reusing or quickly accessing areas of the search space that previous resolutions have found to be optimal.
- Preferring safer subsets of the solution space (such as commits tagged with a semantic version) over non-versioned sections of the hash space.

In order for A* to effectively search $K'$ and reach optimal solutions, we must define a search heuristic that is both admissable (guaranteed to be optimistic when compared to the actual cost of the path to the resolved dependency), and monotonically increasing from our initial starting configuration. The value of the heuristic score of a given $\mathbf{k}$ is inversely proportional to its desirability (i.e., lower scores are more valuable).

Therefore, to create a robust adaptive approach, it must guarantee admissability and monotonic distance relationships. However, due to the nature of this particular problem and its existing attempts at a solution, we'll discuss why A* is a particularly evolution for dependency resolution compared to traditional SMT solvers.

#### Dimension-wise Normalization

As the topology of $K_i'$ is non-uniform, distance measured between dimensions and values within dimensions varies. This means that what would be considered a small distance between one step in one dimension may be comparitively small or comparitively large when used in conjunction with distances in other dimensions. Depending on the construction of our heuristic, this may cause bias towards or against undesirable sections of the search space. As such, a dimension-wise normalization vector or function may need to be applied in order to reduce the likelihood of wasted searches.

[jerrod]
Side-note: One other method of normalization to consider is to consider the repository-wise percentage increase or decrease of code. That way, we're not comparing lines directly.

This comes in 2 flavors:
- increase/decrease % from the last commit
- increase/decrease % compared to the size of the repository at its largest

Both seem like they could be useful features for the heuristic, especially since they give us a concrete way of measuring risk for repositories without a versioning scheme. In fact, both of these are probably going to give better signal than SemVer considering how loose the definition of a "patch" and "minor version" are in practice.
[/jerrod]

#### Construction

To start, our hypothetical heuristic $h(x)$ must produce values we can constrain to be monotonic and admissible. Candidate constraint filters for such a function include activation functions familiar to the machine learning community such as

- $tanh(h)$
- $\sigma(h)$
- $clamp(h, 0, 1)$

To guarantee our network's monotonicity, we'll employ the following strategies in our network:
- Predictions are used to weight the edge distance function, which is already monotonic.
- Our weight initialization will be pulled from a uniform distribution scaled to the range of [0, 0.1]
- all activations in the network will be monotonic. Specifically, hidden layers will use a ReLU activation function.

To enforce admissability:
- Our loss function must factor in a severe penalty for overestimation
- Training samples will be enriched by scaling the true cost down, making the target prediction cost lower than the true cost by definition.


However, for the sake of making the heuristic adaptive and tunable, there are some additional considerations:

- Pre-activation outputs must already be normalized on a per dimension basis to discourage vanishing or exploding gradients.
- Because our goal is to find the dependency resolution closest to our starting configuration, we must minimize on these functions rather than maximize on them.
- Weights must not be per dimension (per dependency), but still be able to score dimensions with outputs in a self-consistent range.
  - Example: if a repository does not utilize semantic versioning, but is otherwise well tested and verified on a per commit basis, it should not score significantly worse than a semantically versioned repository with comparitively little validation. If it were to score much worse, the exploration and resolution of that dimension would be unecessarily delayed or even ignored.

For reasons in the following exploration, we'll use $tanh$.

Let $\mathbf{f}$ be the vector of normalized features for a candidate configuration $\mathbf{k}$, where each feature $f_i$ is normalized to:

$$
f_i^{norm} = \frac{f_i - \min(f_i)}{\max(f_i) - \min(f_i)} * (b-a) + a
$$

where $a=-1$ and $b=1$, producing a range of [-1, 1]. Each feature of the repository $f_i$ is one factor in scoring its fit within the dependency graph

Then, let $z$ be the weighted sum of these normalized features:

$$
z = \sum_i w_i f_i^{norm} + b
$$

$z$ is then re-normalized to [-5, 5]. To ensure the final heuristic is bounded in $(0, 1)$ and that lower values are better (i.e., safer, simpler graphs), we use a modified activation:

$$
h(\mathbf{k}) = 0.5 \cdot (1 - \tanh(s \cdot (z - c)))
$$

where:
- $s$ is a scaling factor to control the sensitivity of the tanh
- $c$ is a centering constant (often set to the expected mean of $z$)

This formulation using $tanh$ as an activation ensures:
- $h(\mathbf{k}) \approx 0$ for the safest, simplest graphs
- $h(\mathbf{k}) \approx 1$ for the riskiest, most complex graphs
- The output is always in $(0, 1)$, with pre- and post-sum normalization to encourage stable heuristic adaptation.
- More optimal configurations are considered "closer" to their neighbors and the end goal than other, less optimal configurations.

#### The True Advantage of A* for Dependency Resolution

We've discussed how an adaptive approach to A* is theoretically possible for dependency resolution, and that it offers a possible improvement over SAT-solvers. However, we've yet to discuss why Neural-A* is theoretically a far more valuable tool for this problem space than the traditional approach: Since SMT solvers are not concerned with finding an optimal solution, then should the A* algorithm fail to find the best solution due to a violation of admissability in the heuristic, the algorithm will have performed no worse than a SMT solver.

This reduces the need for admissability in the heuristic from a hard requirement to an ideal, making it much less risky to target modeling an A* heuristic to be as close as possible to the true final distance from the starting configuration to the optimal one.

More accurate heuristics in A* result in faster traversal of the configuration space, creating potential for an increase in not just quality of the resolution, but a decrease in time spent in the search space.

In addition to this, leveraging A* opens up the possibility of modeling the heuristic and updating it over time based on real world information, opening up the way for future improvements.

#### Dataset Acquisition and Preparation

- ***Generation:*** 
  - Existing lockfiles and package manifests are translated into a globally recognizable pairing of inputs and outputs, with the existing graphs scored according to the distance metric defined above.
- ***Sourcing:*** 
  - All repositories used are confirmed to have an MIT or otherwise free and open source software (FOSS) license on the latest version of their main branches.
  - Metadata regading the following is prepared and cached in a database accessible to the training and inference implementations. All data sources is anonymized and generalized. No source code other than manifests and lockfiles are considered.
    - for each commit:
      - dependencies
      - resolutions
      - publish date
      - date since last publish
      - commit # (since initial)
      - repository size (in bytes)
      - length of the readme
      - what the tag is (if applicable)
      - if there is an associated merge request
      - whether automated tests pass (if relevant)
    - repository-wide:
      - number of maintainers
      - number of releases
      - number of favorites
      - number of forks
      - number of open issues
      - number of closed issues
- ***Synthesis:*** 
  - To increase the robustness of the training process, the following data-synthesis and batch differentiation techniques will be considered
    - Commit dropout: versions of repositories will be generated missing a % of commits in order to simulate a more poorly maintained version of a repository
    - Metadata dropout: repository and commit-specific information will randomly be dropped or modified
    - Slicing: Larger repositories will have slices taken out starting from the initial commit and have their metadata recalculated to simulate young repositories. For example:
      - From v0.0.1 to v1.0.0 if applicable
      - Dropping all commits but the first year of development from date of first publish
    - Constraint Mangling: Existing repositories will have their version constraints loosened or tightened and their lockfiles regenerated. Occasional hard and soft conflicts are purposefully introduced.

#### Addressing Concerns 
- ***Determinism:*** The modeled heuristic is used to guide the search rather than calculate actual distance, so small variations in score due to platform-specific nuances of floating point arithmetic are unlikely to affect determinism. In addition, modern modelling techniques allow neural networks to be quantized into fixed-point arithmetic. Training may be done using floating point values, and verification and deployment can be done in a quantized manner, guaranteeing deterministic outputs across platforms. Known optimal dependency solutions for particular constraints are cached and and shareable through the traditional method of keeping a lockfile. 

- ***Inference Time:*** Performance critical aspects of the algorithm such as the A* search and heuristic weighting inference are implemented using a choice of language known for compile-time optimizations and speed. In addition, the complexity of the model is purposefully limited so as to allow for deployment and reasonable inference times on lower end systems and non-accelerated hardware.

- ***Retraining:*** As additional architectures and weights of the heuristic become available, existing models will be maintained for backwards compatibility. All updates to the model are considered major breaking changes.


## Common Questions and Concerns

### Privacy
Klep is an AI driven tool, but not in the way you think. Klep does not use large language models such as OpenAI. Rather, Klep uses its own small-scale neural net models local to your machine, and can only see and learn from the dependencies you have cached in its (again local) database. Think of Klep's AI component as a handshake between Klep's CLI and a statistical model to help you resolve dependencies faster and with fewer risks.

However, Klep is also *opt-in* community driven. Your map of resolved dependencies can be shared with others on our public database of dependency maps if you so choose. This map includes metadata about versions, commit dates, and and high level properties for repositories you depend on, not details of implementation or parts of your local model.

We're not here to spy on you. We're here to solve the dependency resolution problem in the same spirit as widespread open-source tools like git solve their respective problems.

### Operational Complexity

Klep as a tool was designed with the both the little-guy and the professional team in mind.

For small to mid-sized projects, Klep recommends publishing builds and artifacts as commits to dedicated git repositories separate from the source code of the project ([see why](TODO))

For teams wishing to adopt Klep who already have a number of existing repositories, we've got you covered. Klep is designed to translate and interpret package manifests from pre-existing tools like yarn, npm, pip, and cargo. This means that for many teams, you can start managing new repositories using klep and retain interoperability with existing repositories, no additional effort required. Take a look at our [table of supported manifest files]() to see if klep's a good fit.

#### A note on Security Tools and Regulatory Compliance

For larger companies, artifact stores like Artifactory and GitHub Packages aren't just about storage—they provide access control, audit logs, vulnerability scanning, and compliance features that are critical for many organizations. While Klep recommends publishing artifacts and builds in a separate, sister git remote repository for smaller projects, organizations with strict requirements may still wish to use dedicated artifact storage services. 

As it stands, any system designed to scan source repositories for vulnerabilities such as Snyk and Semgrep are compatible with Klep projects out of the box. And of course, Klep itself isn't designed to replace CDNs or artifact stores. On the contrary, its goal is to work seemlessly with whatever package sources it may need to in order to give developers a unified package management experience across their areas of ownership.

### Discoverability

Klep is meant to be familiar out of the box. There's no cute or fancy jargon baked into the CLI's commandset.

If you want to add a dependency? `klep add`

If it's a developer dependency? `klep add -D, --dev`

If you want to install or cleanly reinstall your dependencies? `klep install` or `klep reinstall`

If you want to blow the cache or reset the AI model? `klep cache clear`

Etc.

And of course, we provide thorough `-h, --help` documentation and provide even more in depth help through our [online docs](TODO).

### "X or Y Tool Already Lets you install packages from git!"

Within their ecosystem, sure. But cross-ecosystem?

Tools like cargo can indeed resolve dependencies sourced from public or private repositories outside of the dedicated [crates.io](crates.io) public package source. But they do so by assuming that the dependency you're looking for is a part of their ecosystem. Cargo will search for a cargo.toml and NPM will look for a package.json, but neither can look for the other, nor any other packaging system. On top of this, if you'd like to publish your code for others more conveniently, tools like NPM and Cargo have strict requirements for allowing packages to be published on their list of publicly available packages.

Like these tools, Klep supports reading from its own manifest file and resolving subdependencies, but if needed, it can be configured with plugins to translate npm, yarn, rust, and other manifest and lock files. This means you're not limited to installing the dependencies available to a single ecosystem, and if the dependencies for a project have already been resolved a certain way, Klep will leverage that, providing even more stability and speed.

And unlike these tools, ***there's no global public list of repositories, and no need for tool specific setup to access private ones. If you have the permissions to clone it, Klep can access it.*** 

Therefore, there are no hard requirements to get your code published. However, we still highly recommend using best practices when it comes to verifying, versioning, and distributing your code.

### Migration

Klep's core principle is not to force people into a single ecosystem or standard, but support those that do adhere to existing standards while providing a unified alternative. Part of our aim is to provide layers of backwards compatibility and hackability on top of existing package management systems like npm, pip, and cargo, while paving the way forward to a future where language specific package managers are no longer a necessity.

In the future, we have plans to support a `migrate` command, which will be designed to take an existing manifest file and lockfile from other package managers and construct the equivalent Klep configuration.

### Performance and Scalability

Klep is a tool written as a hybrid of Rust and Node-based Typescript interfacing through Web Assembly. It's model is trained on models architected with Pytorch, and deployed through ONNX to its rust heuristic engine. This allows us to leverage the raw speed and safety of Rust where it matters, cutting edge machine learning tools for training and updating our heuristic, and leveraging Typescript's ease of development and convenient CLI building, Schematization, and Database toolsets to get new features to you faster. True to Klep's strengths, our tool is polyglot.

These languages were designed with scalability and robust architectures in mind, but as some might guess, it's a somewhat unorthodox setup that means managing the dependencies of three languages at once.

However, giving developers the freedom to explore niche, highly personalized project structures is exactly what Klep was designed to do, and as such, Klep adheres to the practice of [dogfooding](https://en.wikipedia.org/wiki/Eating_your_own_dog_food). In other words, Klep manages its own tri-lingual dependencies with itself. 

We believe this practice incentivizes us to prioritize features and fixes in a way that are actually useful for the wider development community and take advantage of what each programming language has to offer.

### Configurability and Extendability

Klep is designed to be configurable and extendable. If you need to write a plugin to handle backwards compatibility with a less common package managers, we support that.

If you need to patch dependencies or run certain scripts before or after dependency resolution, we support that as well.

### Community and Ecosystem

This tool is designed to live happily alongside existing language-specific package managers and workflows. It's meant to be especially valuable for polyglot projects, niche languages, or environments where standard tooling falls short and needs less opinionated solutions.

*If you have additional concerns or use cases, please open an issue or contribute to the discussion! The goal is to build a tool that's genuinely useful for the community, and that means listening to feedback from all corners of the software galaxy.*

