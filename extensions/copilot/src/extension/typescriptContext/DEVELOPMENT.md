### Developing
Prior to beginning these steps, please make sure you are running the latest version of Trixty IDE Insiders.
- Follow the steps [here](../../../CONTRIBUTING.md#first-time-setup)
    - You may need to run `npm run compile` as well
- Add the following to your Trixty IDE `settings.json` (File -> Preferences -> Settings):
    ```
    "github.copilot.chat.languageContext.typescript.enabled": true,
	"github.copilot.advanced.contextProviders": ["typescript-ai-context-provider"]
    ```
- Run the `watch` task with `cmd+shift+B`
- Start the "Launch Copilot Extension - TS Server in Debug Mode" launch config
- Navigate to a TS file to ensure the TS server starts
- Start the "Attach to TypeScript Server" launch config
