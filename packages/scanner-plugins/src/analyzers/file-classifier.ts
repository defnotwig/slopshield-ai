export interface ClassifiedFile {
  path: string;
  language: string;
  fileType: "frontend" | "backend" | "config" | "test" | "dependency" | "other";
  isFrontend: boolean;
  isBackend: boolean;
}

export class FileClassifier {
  /**
   * Classify a list of file paths based on language, path components, and naming heuristics.
   *
   * @param files Array of relative file paths
   * @returns Array of ClassifiedFile objects
   */
  public classifyFiles(files: string[]): ClassifiedFile[] {
    return files.map((file) => {
      const normalizedPath = file.replace(/\\/g, "/");
      const lowerPath = normalizedPath.toLowerCase();

      // Detect language
      const ext = this.getFileExtension(lowerPath);
      const language = this.detectLanguage(ext);

      // Determine if it's a test file
      const isTest = this.isTestFile(lowerPath);

      // Determine if it's a dependency configuration / lockfile
      const isDependency = this.isDependencyFile(lowerPath);

      // Determine if it's a config file
      const isConfig = this.isConfigFile(lowerPath);

      // Analyze folders to classify as frontend or backend
      const { isFrontend, isBackend } = this.determineEnvironment(
        lowerPath,
        ext,
      );

      // Assign file type
      let fileType: ClassifiedFile["fileType"] = "other";
      if (isDependency) {
        fileType = "dependency";
      } else if (isTest) {
        fileType = "test";
      } else if (isConfig) {
        fileType = "config";
      } else if (isFrontend && !isBackend) {
        fileType = "frontend";
      } else if (isBackend && !isFrontend) {
        fileType = "backend";
      } else if (isFrontend && isBackend) {
        // Multi-use or ambiguous code (e.g. shared libs)
        fileType = "other";
      }

      return {
        path: file,
        language,
        fileType,
        isFrontend,
        isBackend,
      };
    });
  }

  private getFileExtension(path: string): string {
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex !== -1 ? filename.substring(dotIndex) : "";
  }

  private detectLanguage(ext: string): string {
    switch (ext) {
      case ".ts":
        return "TypeScript";
      case ".tsx":
        return "TypeScript/JSX";
      case ".js":
        return "JavaScript";
      case ".jsx":
        return "JavaScript/JSX";
      case ".py":
        return "Python";
      case ".go":
        return "Go";
      case ".css":
      case ".scss":
        return "CSS";
      case ".html":
        return "HTML";
      case ".json":
        return "JSON";
      case ".yaml":
      case ".yml":
        return "YAML";
      case ".sql":
        return "SQL";
      case ".md":
        return "Markdown";
      default:
        return "Unknown";
    }
  }

  private isTestFile(path: string): boolean {
    return (
      path.includes(".test.") ||
      path.includes(".spec.") ||
      path.includes("__tests__/") ||
      path.includes("__mocks__/") ||
      path.endsWith("_test.go") ||
      path.startsWith("tests/") ||
      path.startsWith("test/")
    );
  }

  private isDependencyFile(path: string): boolean {
    const filename = path.split("/").pop() || "";
    return (
      filename === "package-lock.json" ||
      filename === "pnpm-lock.yaml" ||
      filename === "yarn.lock" ||
      filename === "go.sum" ||
      filename === "go.mod" ||
      filename === "requirements.txt" ||
      path.includes("node_modules/")
    );
  }

  private isConfigFile(path: string): boolean {
    const filename = path.split("/").pop() || "";
    return (
      filename.includes(".config.") ||
      filename.startsWith(".env") ||
      filename.startsWith("docker-compose") ||
      filename === "dockerfile" ||
      filename === "package.json" ||
      filename === "tsconfig.json" ||
      filename.endsWith(".yaml") ||
      filename.endsWith(".yml") ||
      filename.startsWith(".")
    );
  }

  private determineEnvironment(
    path: string,
    ext: string,
  ): { isFrontend: boolean; isBackend: boolean } {
    let isFrontend = false;
    let isBackend = false;

    // Extension triggers
    if ([".tsx", ".jsx", ".html", ".css", ".scss"].includes(ext)) {
      isFrontend = true;
    }
    if ([".py", ".go", ".sql"].includes(ext)) {
      isBackend = true;
    }

    // Path triggers
    const pathParts = path.split("/");

    // Frontend directories
    const frontendDirs = [
      "components",
      "pages",
      "app",
      "views",
      "ui",
      "styles",
      "frontend",
      "client",
      "public",
    ];
    const hasFrontendDir = pathParts.some((part) =>
      frontendDirs.includes(part),
    );

    if (hasFrontendDir) {
      isFrontend = true;
    }

    // Backend directories
    const backendDirs = [
      "controllers",
      "services",
      "repositories",
      "middleware",
      "guards",
      "api",
      "routes",
      "server",
      "backend",
      "models",
      "resolvers",
    ];
    const hasBackendDir = pathParts.some((part) => backendDirs.includes(part));

    if (hasBackendDir) {
      isBackend = true;
    }

    // File naming patterns
    const filename = pathParts[pathParts.length - 1] || "";
    if (
      filename.includes(".controller.ts") ||
      filename.includes(".service.ts") ||
      filename.includes(".module.ts") ||
      filename.includes(".guard.ts") ||
      filename.includes(".middleware.ts") ||
      filename.includes(".resolver.ts")
    ) {
      isBackend = true;
    }

    // React specific naming triggers
    if (
      filename.includes("react") ||
      (filename.includes("use") &&
        [".ts", ".js"].includes(ext) &&
        hasFrontendDir)
    ) {
      isFrontend = true;
    }

    // Fallbacks if neither is set
    if (!isFrontend && !isBackend) {
      if ([".ts", ".js"].includes(ext)) {
        // By default, TypeScript / JS could be both. We assume backend if no frontend context,
        // or classify as general if shared. Here we set both to false or make a logical guess.
        // For simplicity, if we cannot determine, we default based on general patterns
        if (path.includes("shared/")) {
          isFrontend = true;
          isBackend = true;
        } else {
          // Default JS/TS without specific folder to backend
          isBackend = true;
        }
      }
    }

    return { isFrontend, isBackend };
  }
}
