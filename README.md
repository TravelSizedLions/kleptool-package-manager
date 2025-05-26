# Kleptool: Neural A*-SMT for Versionless Dependency Resolution in Theoretical and Practical Terms

What a banger of a title, am I right? 🤜💥🤛

## Abstract
In this document, we'll explore the theoretical and technical challenges of implementing a language and versioning agnostic recursive dependency resolver using a novel formulation of the A* optimization algorithm. This formulation of A* will leverage Stochastic Gradient Descent to weight the linear combination of its neighbor-distance and heuristic-distance aspects to learn an efficient cost function for traversing a configuration space of candidate dependency graphs. We will also explore how this SGD cost function could be implemented to fine-tune itself to individual user and project needs and patterns.

First, we'll explore a rigorous application of the theories involved in this design, followed by a discussion of their synergies. Then, we'll then go on to discuss practical requirements for such a tool, including:

- Building and maintaining the A* configuration space
- The time and computational cost to cache and clone repositories
- Resolving non-semantic version targets together with semantic targets
- Architecting, initializing, training, and tuning a custom, locally deployable neural model
- Updating dependencies from partial solutions
- Recovering from expired or missing cached dependencies
- Extracting and normalizing disjointed project structures, and how such structures affect the implementation of the Neural A*-SMT resolver

Then, we'll consider how these aspects affect the formulation and initialization of the A*I-SMT distance and heuristic functions.

### In God's own English

I'm building a package manager that straps a smallish neural network to a well-known path-searching algorithm to figure out which versions of dependencies to install when the target versions are such comforting values as `v0.0.1-alpha`, `>=sufjw0n9273lklksjf72kdfjsy8`, `feature-x-branch-do-not-merge`, and my personal favorite, `latest`.

If that sounds absurd, don't worry—it absolutely is—and I'll explain why it's sorely needed, and actually a pretty well-reasoned approach despite it incidentally being made up of exclusively tech buzz-words.

### Motivation

If you're writing a python tool, a web application, a .NET app, or something an unironic PHP-enjoyer would want to write in PHP, you've already got a package ecosystem for that. Why would you ever use or need a package management system that explicitly isn't tailored to your language of choice?

Well…what if you're writing a tool in multiple languages? What if one or more of those languages have a small following and don't have a dedicated package manager or a community big enough or experienced enough to build one?

What if your dependencies are build tools and design tools with release versions numbered by year, or that have a GUI component? Or what if they're just some github repo a community member dumped on Reddit at some point with no official release version? What if you don't really have much choice if you want or need to write your software in that limited environment?

If that's you, then you're probably a hobby developer like me.

I know this pain from wanting to develop games. Most game engines come with either limited (and proprietary) dependency management or basically none at all. If they do have a way to get and install dependencies, it's not recursive, and they're locked behind the paywall of an asset store. Hell, the situation is so glaringly bad that Godot's otherwise-brilliant GDScript and free asset store refuses to implement namespaces and so every named class in your project, addon or not, is *global.* 

Because most games are developed by one or two pasty 20-somethings with crappy laptops, a basement, and a dream, a lot of the most useful dependencies end up coming from abandoned or barely maintained projects that don't follow any real standard, let alone have official releases.

I think that in reality, these things are more of a symptom for the real problem: the *.wheel keeps getting re-invented for specific languages, when the basic approach is almost always the same for every major package manager: build a public repository for packages, enforce versioning, enforce directory structures, enforce tooling, resolve dependencies with SAT, .lock things in place, and let people run scripts.

But despite that, no-one's sought to actually, *fully* solve the general case, i.e., for all project structures, versioning schemes, and languages. Game dev isn't alone in this. Any hobby project not tied to a handful of big languages is going to be lacking in the kind of tooling to build a robust, shareable, and replicatable solution. The end result is that niche hobby-devs can't cross-pollinate their open source tools and packages with their communities as effectively, and struggle to get team mates for their projects on-boarded. Worst of all, young developers eager to experience what it's like to code learn crappy development habits from the communities they engage with.

We've got some of the most brilliant developers in the world alive today and some of the most sophisticated algorithms to help us solve this problem for everyone. Why hasn't a general-purpose package manager broken through into the mainstream?

Well…I don't know. As far as my planning and efforts have gone so far, there's literally no reason why something like that can't exist at this point. I mean, for crying out loud guys, someone got [Doom to run on the typescript transpiler.](https://www.youtube.com/watch?v=0mCsluv5FXA&t=7s) I think we can figure out general-purpose package management.

So let's do it.

## The A* Algorithm


The A* algorithm finds the optimal path between two nodes in a graph by maintaining two sets of nodes and using a scoring function to evaluate potential paths.

### Algorithm Steps

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
        - If $\exists n \in Q_{open}: score(n) < score(s), n \ne s$, skip
        - If $\exists n \in Q_{closed}: score(n) < score(s), n \ne s$, skip
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

- The dimension-wise unique hash $h_j$
- The ordinal set $d_j$ of dependencies on other dimensions 
- The co-ordinal set of constraints $c_j$ on $d_j$ that are the acceptable hash values of each dependency

So the range of each dimension $K_i$ describes the following about a particular repository:

- A set of possible dependencies $D_i= \bigcup\limits_{j=1}^{m} d_j$
- A a set of possible constraints on those dependencies $C_i = \bigcup\limits_{j=1}^{m}c_j$
- A set of hashes $H_i=\bigcup\limits_{j=1}^{m}h_j$
- A function $\delta_i(K_i, j) \rarr (h_j, d_j, c_j)$ mapping $h_j$ to its tuple of related ordinal sets $d_j$ and $c_j$


In a localized range of hash values within a dimension, the number of dependencies and constraints for one hash is not strictly required to be close in number to its neighboring hashes. One hash may add 0 dependencies, 1, or 20, or remove all dependencies--along with anything in-between. However, there's an *a priori* expectation that the number of dependencies in a repository will trend upwards over time. Therefore, "higher" or rather *later* hashes in the dimension will also have more constraints than earlier values.

Since the number of repositories in $K$ is effectively infinite, the number of valid commit hashes in each repository is not the same, and the number of dependencies and constraints for each commit in each repository is non-deterministic within local ranges of each repository's corresponding dimension, the vector space of possible configurations for a dependency graph is the following unbounded, non-uniform, non-convex topology:

$$
K = \bigcup\limits_{i=1}^{\infty} 
\left\{
  \bigcup\limits_{j=1}^{\lvert\lvert K_i \rvert\rvert}h_j, 
  \bigcup\limits_{j=1}^{\lvert\lvert K_i \rvert\rvert}d_j, 
  \bigcup\limits_{j=1}^{\lvert\lvert K_i \rvert\rvert}c_j
\right\}
$$

Or in simpler terms, $K = \{\{D_1, C_1, H_1\}, \{D_2, C_2, H_2\}, \dots \}$ *ad infinitum*.

### A Point in the Space

In our configuration space $K$, a single point (or node) in the space represents one possible dependency graph, where for each dimension in $K$, there is an assignment $\Theta(K_i)$ of a particular hash in each dimension.


### Successors

A successor node is discovered by:
1. Changing a version assignment within the range of versions within the dependency's constraints
2. The addition of net-new dependencies on the current node.
3. The addition or removal of new constraints

The distance between nodes considers:
- Version change distance
- Time to fetch new dependencies
- Risk of breaking changes
- Historical success rate

Formally, for nodes $n_1$ and $n_2$:
$$
cost(n_1, n_2) = w_1 \cdot \Delta V + w_2 \cdot \Delta D + w_3 \cdot \Delta R + w_4 \cdot risk(n_2)
$$

#### The Risk Function
Risk is a quantification of the likelihood that traversing to the given successor graph would create problems with imports and pathing for the dependencies. This includes factors like:

- An increase in the complexity of dependency extraction
- Expected growth in the number of dependencies
- A change in version type (semver, tag, hash, branch)

#### Historical Success
"Historical Success" is the term used to describe saving previously satisfied groups of dependencies that are often resolved together. The presence of these sub-graphs implies a risk of 0 for that part of the graph when the same group of dependencies and constraints appear during a dependency update.

### Defining a Starting Node

The starting node $n_{start}$ is defined by:
- Direct dependencies from the project file
- Initial version constraints
- Empty set of discovered dependencies
- All constraints marked as unresolved

This represents the initial state before any resolution begins.

### Finding a valid End State

A node $n_{end}$ is valid when:
1. All known dependencies have versions assigned
2. All constraints are resolved
3. No conflicts exist
4. SMT solver verifies the solution

Formally:
$$
valid(n) = \begin{cases}
true & \text{if } U = \emptyset \land conflicts(n) = \emptyset \land SMT(n) = true \\
false & \text{otherwise}
\end{cases}
$$

The unbounded configuration space includes all combinations of version hashes of all repositories listed as dependencies. 

## Stochastic Gradient Descent and Parameterizing A*

Gradient 
