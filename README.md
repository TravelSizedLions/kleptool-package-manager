# Klep: General-purpose Agnostic Dependency Resolution using Neural A* SMT Heuristics

What a banger of a title, am I right? 🤜💥🤛

## Abstract

In this document, we'll explore the theoretical and technical challenges of implementing a language and versioning agnostic recursive dependency resolver using a novel formulation of the A* optimization algorithm. This formulation of A* will leverage Stochastic Gradient Descent to weight the linear combination of its distance and heuristic functions to learn an efficient strategy for traversing a configuration space of candidate dependency graphs. We will also explore how this SGD-based cost function could be implemented to fine-tune itself to individual user and project needs and patterns.

First, we'll explore a rigorous application of the theories of A* and SMT involved in this design, followed by a discussion of their synergies. Then, we'll formalize the dependency resolution process and end goals. After, we'll go on to discuss practical requirements for such a tool, including:

- Building and maintaining the A* configuration space
- The time and computational cost to cache and clone repositories
- Resolving non-semantic version targets together with semantic targets
- Architecting, initializing, training, and tuning a custom, locally deployable neural model
- Updating dependencies from partial solutions
- Recovering from expired or missing cached dependencies
- Extracting and normalizing disjointed project structures, and how such structures affect the implementation of the Neural A*-SMT resolver

We'll then use these considerations and others to formulate Neural A*-SMT distance and heuristic functions.

### Motivation

If you're writing...

- A python tool
- A web or mobile application
- A .NET or Rust application
- Or something an unironic PHP-enjoyer would want to write in PHP

...then you've already got a package ecosystem for that. Why would you ever use or need a package management system that isn't tailored to your language of choice?

Well, what if you're writing a tool in multiple languages? What if one or more of those languages have a small following and don't have a dedicated package manager or a community big enough or experienced enough to build one?

An experienced developer might retort, mentioning that language agnostic dependency management tools like Gradle, Maven make it possible to manage dependencies and run builds for language contexts other than the Java landscape they were born in. In their minds such tools already exist.

Well, what if one's dependencies include build tools and design tools with release versions numbered by year, or that have a GUI component? Or what if they're just some github repo a community member dumped on Reddit at some point with no official release version? What if you don't really have much choice if you want or need to write your software in that limited environment? 
And what if the target versions you have to work with are such comforting values as `v0.0.1-alpha`, `>= sufjw0n9273lklksjf72kdfjsy8`, `feature-x-branch-do-not-merge`, or my personal favorite, `latest`.

If you've run into this, then you've probably done hobby development at some point in your life. You use languages and tools with small, scrappy, dedicated communities that may not have the time or the energy to build proper CI/CD for their projects, and certainly don't have the capacity to write their own packaging toolset.

Personally, I know this pain from wanting to develop games. Most game engines come with either limited (and proprietary) dependency management or basically none at all. 

If they do have a way to get and install dependencies:
- It's not recursive, so it has no concept of transitive dependencies
- Or if it is, it doesn't handle resolving version constraints on those transitive dependencies
- Or if they do, the packages that support these things are locked behind the paywall of a proprietary asset store

Yet many of these environments have a desparate need for solid dependency resolution outside of a closed ecosystem. For instance, Godot's otherwise-brilliant GDScript language and free asset store lacks namespacing, and so every named class in your project, addon or not, is *global.* Godot's asset store also contains a fraction of the assets that are actually available to all users of Godot, and has no concept of dependency resolution, so mid-sized projects have one of four options:
- Manage every dependency and namespace collision themselves
- Use a tool like Gradle or Maven, which has no official Godot support
- Eschew dependencies entirely and implement everything their project needs from scratch
- Or switch to a language binding like C# or Rust with better tooling.

In addition to this, most small-scale projects are developed by at most a handful of individuals working part-time, and many useful dependencies end up coming from barely maintained projects that don't follow any real standard, let alone have official releases tagged with semantic versioning . This development context can't rely on anything most popular languages and package managers take for granted.

We in the development community have a core problem: the *.wheel keeps getting re-invented for specific languages in a limited capacity. The basic approach is almost always the same for every major package manager: 
- build a public source for packages to be published
- enforce versioning on those publishes
- enforce directory structures
- enforce tooling
- resolve dependencies with SAT solvers
- *.lock resolved versions in place.

Despite the approach always being the same, no-one's sought to actually, *fully* solve the general case problem of dependency management, i.e., for all project structures, sources, versioning schemes, and languages. 

And, as much as the core motivation for my efforts started with helping the hobby developer, small-scale projects aren't the only context in which this is an issue. Even larger organizations using standardized tools will sink significant portions of their budget re-inventing and maintaining tooling built on top of the standard tools, and this includes solutions for package management and publishing. Entire businesses and products have been built up around the need for organizations to privately store publish artifacts for internal use. However, if organizations are given a tool that allows them to use their own remote git repositories as sources for published dependencies, then paying for external package hosting services such as artifactory or GitHub Packages becomes unecessary. We don't need artifact stores when remote repositories already exist and are perfectly capable of hosting production builds of your source code for distribution.

Both the industry and the individual stand to benefit from a general purpose solution to package management and dependency resolution, one that can handle a complex or non-ideal development environment. The benefits that would come from a language and versioning agnostic dependency resolver are numerous:
- No more need for dedicated package stores
- No need to re-learn CLIs and tooling when hopping from language to language or project to project
- Support for semantic version tags when they exist, and other schemes when they don't.
- Greater precision in resolving exactly which version of which dependencies are needed for each project, down to individual commits if necessary.
- The capacity to work with and standardize non-standard project layouts in your dependencies

## The A* Algorithm


The A* algorithm finds the optimal path between two nodes in a graph by maintaining two sets of nodes and using a scoring function to evaluate potential paths.

### A* Algorithm Steps

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

## Satisfiability and SMT

### Boolean Satisfiability (SAT)

Satisfiability describes a problem space where the goal is to determine if a given set of boolean clauses can be resolved to TRUE. These clauses are typically given in Conjunctive Normal Form (CNF), which is a normalized form where clauses are ANDed together, and each clause is a disjunction (OR) of literals. For example:

$$
(\neg x_1 \land y_1 \land \neg z_1) \lor
(x_2 \land y_2 \land z_2) \lor \dots  
\lor (x_n \land y_n \land z_n)
$$

This is known as 3-SAT because each clause contains exactly three literals. The problem asks: "Is there an assignment of TRUE/FALSE values to the variables that makes the entire expression TRUE?"

### Satisfiability Modulo Theories (SMT)

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

### Why This Matters for Dependency Resolution

In dependency resolution, we can frame our constraints as SMT predicates:

- Version compatibility: $version(dep1) \geq required\_version$
- Conflict avoidance: $\neg (version(dep1) = version(dep2))$
- Feature requirements: $has\_feature(dep, feature) = true$

The SMT solver can then find a satisfying assignment that meets all these constraints, effectively finding a valid set of dependency versions.

## SMT and A* Heuristic Dependency Resolution

### The Core Problem

To solve a problem like dependency resolution, the question becomes "Can I find a set of dependency versions that won't break the consumers of those dependencies and also do not conflict with one another?"

Thankfully, this is exactly the kind of problem SMT and Semantic Versioning was designed to solve.

Except…It's not. Not quite.

### The Recursion Problem

There's a complication to finding a set of dependencies whose versions do not conflict with one another and satisfy the needs of their consumers, and that complication is *recursion*. **Because dependencies can add and remove additional dependencies from version to version**, there's no telling what dependencies actually need to be installed for a given version until we try it.

This creates a chicken-and-egg problem:
1. To know what dependencies we need, we need to know the versions
2. To know the versions, we need to know what dependencies we need

### Combining SMT and A*

Thankfully, while "Can I find a set of X,Y,Z that fits my needs A,B,C?" is the only kind of problem SMT cares about solving, algorithms such as A* only cares about solving "What's the best thing to do and how do I do it?" kind of problems—in other words, optimization problems. 

Since the actual question behind dependency resolution is "How do I find a set of dependencies that satisfy constraints when I don't know what all of the dependencies are ahead of time?", that implies the answer is some amalgamate algorithm of the two approaches.

#### How It Works

1. **A\* Explores the space of possible dependency graphs**
   - Each node represents a potential dependency state
   - Edges and edge distance represent version changes and other time/risk costs
   - The heuristic estimates how close we are to a valid solution
   - The full cost function considers version compatibility

2. **SMT Validates Solutions**
   - When A* finds a potential path
     - SMT checks if it satisfies all constraints
     - If not, A* continues searching
     - If yes, we've found our solution

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

- The hash $h_{i_j}$, which is unique within the repository's dimension
- The ordinal set $d_{i_j}$ of dependencies on other dimensions, which are edges to other dimensions in space
- The co-ordinal set of constraints $c_{i_j}$ on $d_{i_j}$ that are the acceptable hash values of each dependency

So the range of each dimension $K_i$ describes the following about a particular repository:

- A set of possible dependencies $D_i= \bigcup_{j=1}^{m} d_{i_j}$
- A a set of possible constraints on those dependencies $C_i = \bigcup_{j=1}^{m}c_{i_j}$
- A set of hashes $H_i=\bigcup_{j=1}^{m}h_{i_j}$
- A function $\delta_i(j) \rarr (h_{i_j}, d_{i_j}, c_{i_j})$ mapping $h_{i_j}$ to its tuple of related ordinal sets $d_{i_j}$ and $c_{i_j}$
  - For example: $\delta_i(5)$ returns the hash, dependencies, and constraints for the 5th commit in repo $i$


In a localized range of hash values within a dimension, the number of dependencies and constraints for one hash is not strictly required to be close in number to its neighboring hashes. One hash may add 0 dependencies, 1, or 20, or remove all dependencies--along with anything in-between. However, there's an *a priori* expectation that the number of dependencies in a repository will trend upwards over time (though this is not guaranteed). Therefore, "higher" or rather *later* hashes in the dimension will also have more constraints than earlier values.

Since:
 - The number of repositories in $K$ is effectively infinite
 - The number of valid commit hashes in each repository is not the same
 - The number of dependencies and constraints for each commit in each repository is non-deterministic within local ranges of each repository's corresponding dimension

 Then the vector space of possible configurations for a dependency graph is the following unbounded, non-uniform, non-convex topology:

$$
K = \bigcup\limits_{i=1}^{\infty}\left\{\bigoplus\limits_{j=1}^{\lvert\lvert K_i \rvert \rvert} (h_j, d_j, c_j)\right\}
$$

Or:

$$
K = \{
  [
    (h_{i_j}, d_{i_j}, c_{i_j}) 
    \vert 
    j=1\dots \lvert\lvert K_i \rvert\rvert
  ]
  \vert
  i=1 \dots\lvert\lvert K \rvert\rvert
\}
$$

In other words, the configuration space is the set of all possible combinations of commit hashes (and their associated dependencies and constraints) across all repositories.

## Bounding K-Space
<p>
In practice, not all repositories that exist are needed as dependencies for every project (though seeing such a project would be entertaining)<sup>[citation needed]</sup>

This means that to resolve the dependencies for any given repository, we only care about a specific subspace of $K$—namely, the part that includes just the dependencies (and their dependencies, and so on) that are actually relevant to our project. In other words, we want to "zoom in" on the part of $K$ that matters for $K_i$ and ignore the rest of the infinite space of possibilities.

Let's formalize this idea for use later:

- As mentioned above, for each $K_i$, we have
  - $H_i$ the set of all commit hash values $h_{i_j}$ in $K_i$
  - $D_i$, the set of all dimensions reachable from $K_i$ through all dependency sets $d_{i_j}$ in $K_i$. This is also known as the dependency closure of $K_i$
  - $C_i$, the set of all sets of constraints on $D_i$ from $H_i$.

- For each $K_d \in D_i$, let $H_d'$ be the set of hashes in $K_d$ that are possible given the constraints induced by traversing from $K_i$.
  - ***Note:*** 
    - $H_d'$ is the set of hashes in $K_d$ allowed by the currently active constraints in this resolution, where those constraints are imposed by the dependency graph rooted at $K_i$.
    - $C_i$ is the set of all possible sets of constraints that $K_i$ could ever impose on its dependencies, across all its hashes. 
    - In other words, $C_i$ describes the universe of possible requirements $K_i$ might have for its dependencies, while $H_d'$ is the set of versions of $K_d$ that actually satisfy the piecewise dependency constraints currently in play for a given commit hash $h_{i_j} \in H_i$.


Then the subspace of $K$ constrained for a given $K_i$ is the finite, non-uniform, non-convex space:

$$
K_i' = \prod_{K_d \in C_i} H_d'
$$

Or, more explicitly,  $K_i' = \left\{ (h_d)_{K_d \in D_i} \;\middle|\; h_d \in H_d',\ \forall K_d \in D_i \right\}$


#### Example
Suppose $K_i$ depends on $K_a$ and $K_b$, and $K_a$ depends on $K_c$. Then $D_i = \{ K_i, K_a, K_b, K_c \}$, and the subspace $K_i'$ is all possible assignments of hashes to these four repos, subject to the constraints that come from the initial dependency relationships imposed by $K_i$.
</p>



## The Graph Representation of Bounded K-Space

### Nodes
In our limited configuration space $K_i'$, a single point in the space represents one possible dependency graph, represented by a set $\mathbf{k} \in K_i'$ in which each element is one hash from each dependency needed by the repository.

### Edges

As mentioned [above](#dimensions-in-the-space), each point $h_{i_j}$ in a dimension $K_i$ comes with two sets associated with it: the set of needed dependencies $d_{i_j}$ and the set of version constraints on those dependencies $c_{i_j}$. A value in the dependency set $d_{i_j}$ represents a connection from the dimension $K_i$ to another dimension $K_d \in D_i$ with $K_i \ne K_d$. However, this graph relationship is describing the connections of the dependency graph that each node $\mathbf{k}$ represents.

To understand edges in the graph of $K_i'$, we also need to define what constitutes the neighborhood of a node $\mathbf{k}$. If $\mathbf{k}$ is a single node in the graph $K_i'$, then $\mathbf{k}$'s neighbors are nodes in $K_i'$ which are only one step away from $\mathbf{k}$ in a single dimension. In practical terms, neighbors of $\mathbf{k}$ have a difference of one hash, either the one immediately prior to or immediately succeeding the commit specified by that repository's dimension in $\mathbf{k}$.

## Application of A* on Bounded K-Space

For an implementation of A* to search through the $K_i$

### The Initial Configuration

The A* Algorithm calls for an initial configuration to place on its open queue (See the [algorithm steps](#a-algorithm-steps)).

In modern software package management systems, the list of root dependencies of a project are specified in a manifest. These specified target versions conveniently serve as a A*'s starting node $n_{start}$. While the root dependencies in these types of manifests do not include all possible repositories serving as dimensions of $K_i'$, this is remediable by following the cascade of transitive dependencies until we fill out the initial configuration. Any remaining dimensions in $K_i'$ not intialized by this process are *possible* transitive dependencies that may not be explored during dependency resolution.

#### Alternative Initializations

As one key feature of dependency resolvers is the caching and reusing of partial resolutions, initialization should also weigh a variety of other possible starting places for a candidate graphs based on previous resolutions. (#TODO - add to this more later as I explore)

### The Solution Set
Formally, a point in the subspace $K_i'$ is a tuple $\mathbf{k} = (k_d)_{d \in D_i}$, where each $k_d \in H_d'$. A tuple $\mathbf{k}$ in which all constraints are satisfied for the root dependencies of the project represents a valid assignment (i.e., a candidate dependency graph) in $K_i'$. This makes $K_i'$ the search space of possible dependency resolutions for repository $K_i$. However, not every assignment of $\mathbf{k}$ is a valid dependency resolution, since not every $\mathbf{k}$ satisfies the constraints applied by dependencies in $\mathbf{k}$ for other dependencies in $\mathbf{k}$. 


To reach the solution set of valid dependency graphs, values for each dimension in $\mathbf{k}$ must satisfy the constraints posed by each other dimension of the assignment:

$$
\mathcal{V_i} = \{ \mathbf{k} \in K_i' \mid \mathbf{k} \text{ satisfies all constraints applied by values in } \mathbf{k} \}
$$

### Distance

The distance between values of $\mathbf{k}$ is where we begin to re-enter the realm of practicality. For a real life implementation of an A* Neural Resolver, the cost factor of exploring one node in the configuration space over another could include multiple factors.

- How does the neighbor affect the dependency graph?
  - How many new transitive dependencies are added and/or removed?
  - Do the added/modified transitive dependencies contain riskier requirements or safer ones? Do removed transitive dependencies reduce the number of risky requirements?

- How big is the change from one version to the next?
  - Major > Minor > Patch > Meta (as in meta information appended to the tag such as `rc1`, `alpha`, and `beta`), and single commit differences are closest of all

- How big is the change in actual code from one commit to the next?

- What's the change in risk?
  - Does the new version have known security vulnerabilities?
  - Does the new version have known breaking changes?
  - Does the new version have transitive dependencies that need to be cloned or additional commits to be pulled?
  - Are all dependencies in the new configuration compatible with the license of the project?

- How restrictive are the constraints on the new version compared to the existing version?
  - Wider constraint ranges mean searching through more transitive dependencies for a candidate.
  - Smaller constaint ranges mean less space to search, but provides fewer potential opportunities for optimization
- Popularity of the dependency
  - More widely used dependencies tend to score better and have fewer compatibility problems than rarely used dependencies)
- Maintenence Status of the dependency

  - When was the last commit or tagged version of this dependency?
  - How often on average are changes made to this dependency, and how big are they?

### The Solution Heuristic

#### Observations
For traditional dependency resolution, the problem space is to find one of potentially several sets of versions for dependencies which satisfy all constraints put in place by all sources in the space.

Here, our goal is to instead balance the optimization of several factors, including:

- Picking versions that minimize the risks posed to the root project
- Resolving quickly
- Minimizing the number of dependencies overall
- Staying relatively close to the user-specified target version
- Reusing or quickly accessing areas of the search space that previous resolutions have found to be optimal.
- Preferring safer subsets of the solution space (such as commits tagged with a semantic version) over non-versioned sections of the hash space.

In order for A* to effectively search $K'$ and reach optimal solutions, we must define a search heuristic that is both admissable (guaranteed to be optimistic when compared to the actual cost of the path to the resolved dependency), and monotonically increasing from our initial starting configuration. The value of the heuristic score of a given $\mathbf{k}$ is inversely proportional to its desirability (i.e., lower scores are more valuable).

Therefore, to create a robust adaptive approach, it must guarantee admissability and monotonic distance relationships.

#### Dimension-wise Normalization

As the topology of $K_i'$ is non-uniform, distance measured between dimensions and values within dimensions varies. This means that what would be considered a small distance between one step in one dimension may be comparitively small or comparitively large when used in conjunction with distances in other dimensions. Depending on the construction of our heuristic, this may cause bias towards or against undesirable sections of the search space. As such, a dimension-wise normalization vector or function may need to be applied in order to reduce the likelihood of wasted searches.

#### Construction

To start, our hypothetical heuristic $h(x)$ must produce values we can constrain to be monotonic and admissible. Candidate constraint filters for such a function include activation functions familiar to the machine learning community such as 

- $tanh(h)$
- $\sigma(h)$
- $clamp(h, 0, 1)$

However, for the sake of making the heuristic adaptive and tunable, there are some additional considerations:

- Pre-activation outputs must already be normalized on a per dimension basis to discourage vanishing or exploding gradients.
- 



## Stochastic Gradient Descent and Parameterizing A*

Gradient 

## Common Questions and Concerns

### Privacy
Klep is an AI driven tool, but not in the way you think. Klep does not use large language models such as OpenAI. Rather, Klep uses its own smale-scale neural net models local to your machine, and can only see and learn from the dependencies you have cached in its (again local) database. Think of Klep's AI component as a handshake between Klep's CLI and a statistical model to help you resolve dependencies faster and more safely.

However, Klep is also *opt-in* community driven. Your map of resolved dependencies can be shared with others on our public database of dependency maps if you so choose. This map includes metadata about versions, commit dates, and and high level properties for repositories you depend on, not details of implementation or parts of your local model.

We're not here to spy on you. We're here to solve the dependency resolution problem in the same spirit as widespread open-source tools like git solved version control.

### Operational Complexity

Klep as a tool was designed with the both the little-guy and the professional team in mind.

For small to mid-sized projects, Klep recommends publishing builds and artifacts as commits to dedicated git repositories separate from the source code of the project ([see why](#TODO))

For teams wishing to adopt Klep who already have a number of existing repositories, we've got you covered. Klep is designed to translate and interpret package manifests from pre-existing tools like yarn, npm, pip, and cargo. This means that for many teams, you can start managing new repositories using klep and retain interoperability with existing repositories, no additional effort required. See our [table of supported manifest files]() to see if klep's a good fit.

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

And of course, we provide thorough `-h, --help` documentation and provide even more in depth help through our [online docs](#TODO).

### "X or Y Tool Already Lets you install packages from git!"

Within their ecosystem, sure. But cross-ecosystem?

Tools like cargo can indeed resolve dependencies sourced from public or private repositories outside of the dedicated [crates.io](crates.io) public package source. But they do so by assuming that the dependency you're looking for is a part of their ecosystem. Cargo will search for a cargo.toml and NPM will look for a package.json, but neither can look for the other, nor any other packaging system. On top of this, if you'd like to publish your code for others more conveniently, tools like NPM and Cargo have strict requirements for allowing packages to be published on their list of publicly available packages.

Like these tools Klep supports reading from its own manifest file and resolving subdependencies, but if needed, it can be configured with plugins to translate npm, yarn, rust, and other manifest and lock files. This means you're not limited to installing the dependencies available to a single ecosystem, and if the dependencies for a project have already been resolved a certain way, Klep will leverage that, providing even more stability and speed.

And unlike these tools, ***there's no global public list of repositories, and no need for tool specific setup to access private ones. If you have the permissions to clone it, Klep can access it.*** 

Therefore, there are no hard requirements to get your code published. However, we still highly recommend using best practices when it comes to verifying, versioning, and distributing your code.

### Migration

Klep's core principle is not to force people into a single ecosystem or standard, but support those that do adhere existing standards. Part of our aim is to provide layers of backwards compatibility and hackability on top of existing package management systems like npm, pip, and cargo while paving the way forward to a future where language specific package managers are no longer a necessity.

In the future, we have plans to support a `migrate` command, which will be designed to take an existing manifest file and lockfile from other package managers and construct the equivalent Klep configuration.

### Performance and Scalability

Klep is a tool written as a hybrid of Rust and Node-based Typescript interfacing through Web Assembly. This allows us to leverage the raw speed and safety of Rust where it matters, and where it doesn't, instead take advantage of Typescript's ease of development and convenient CLI building and Database toolsets to get new features to you faster.

Both languages were designed with scalability and robust architecture in mind, but as some might guess, is a somewhat unorthodox setup that means managing the dependencies of two languages at once.

However giving developers the freedom to explore niche, highly personalized project structures is exactly what Klep was designed to do, and as such, Klep adheres to the practice of [dogfooding](https://en.wikipedia.org/wiki/Eating_your_own_dog_food). In other words, Klep manages its own dual-language dependencies with itself. 

We believe this practice incentivizes us to prioritize features and fixes in a way that are actually useful for the wider development community.

### Configurability and Extendability

Klep is designed to be configurable and extendable. If you need to write a plugin to handle backwards compatibility with a less common package managers, we support that.

If you need to patch dependencies or run certain scripts before or after dependency resolution, we support that.

### Community and Ecosystem

This tool is designed to live happily alongside existing language-specific package managers and workflows, but it's meant to be especially valuable for polyglot projects, niche languages, or environments where standard tooling falls short and needs less opinionated solutions.

*If you have additional concerns or use cases, please open an issue or contribute to the discussion! The goal is to build a tool that's genuinely useful for the community, and that means listening to feedback from all corners of the software galaxy.*

