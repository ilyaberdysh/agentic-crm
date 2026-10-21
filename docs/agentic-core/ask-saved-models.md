# Ask Agentic with a saved model

Ask Agentic can answer using a saved OpenAI API, Anthropic API, or enrolled runner's local OpenAI-compatible model. Open Ask AI from Home, a record, or Chats and select the saved target in the model picker. API and Local labels identify its execution destination. If there is no server Anthropic key, a new chat selects the first available saved target.

This mode provides text answers from the conversation and the CRM context attached by the user, including the current record and mentions. It has no CRM tools or web search. Answers arrive when the target finishes, through the normal chat/SSE channel. Titles use the question; automatic reply suggestions are disabled. Other AI features, including record summaries, continue to use the server LLM.

Saved targets use the owner's API billing or local model. They do not consume CRM credits and remain usable when prepaid credits are exhausted. `model_invocations` stores provider usage and explicit known/unknown cost; an unknown price or missing usage is not converted into zero cost. The chat's `creditCost` stays null.

## Operator setup

Target setup uses the existing authenticated tRPC procedures. Send POST requests to `/trpc/<procedure>` (or `/api/trpc/<procedure>` through the web proxy), with a JSON body, the signed-in session cookie, and `x-workspace-slug`. Keep provider keys out of URLs, logs, and source files. Only admins create workspace targets; personal targets are visible only to their owner.

1. Call `agentic.models.connections.create` with a new UUID, `ownerKind` (`member` or `workspace`), `provider` (`openai` or `anthropic`), and `apiKey`. The response exposes masked metadata and its version.
2. Call `agentic.models.targets.create` using a new UUID and the returned connection ID/version:

   ```json
   {
     "id": "<new-target-uuid>",
     "name": "My API model",
     "kind": "cloud-api",
     "ownerKind": "member",
     "provider": "openai",
     "model": "<provider-model-id>",
     "connectionId": "<connection-uuid>",
     "connectionVersion": 1
   }
   ```

3. Reload Ask AI or reopen the model picker after its settings invalidation. Select `My API model · API` and send a question with a record attached.

For a local model, enroll and start the standalone runner first. Call `agentic.models.targets.create` with this shape and the enrolled runner ID:

```json
{
  "id": "<new-target-uuid>",
  "name": "My local model",
  "kind": "runner-local",
  "ownerKind": "member",
  "provider": "openai-compatible",
  "model": "<local-model-id>",
  "runnerId": "<enrolled-runner-uuid>",
  "endpoint": "http://127.0.0.1:11434/v1",
  "features": {
    "text": true,
    "clientTools": false,
    "structuredOutput": "none",
    "streaming": false
  }
}
```

The cloud queues an encrypted request and never fetches the local endpoint. Only the matching enrolled runner can claim it and return an encrypted-at-rest result. The chat waits up to two minutes. Stop cancels queued/leased work and fences late completions; an already running provider call may still consume provider resources.

Model choices encode `target:<target UUID>:<version>`. Every send/retry checks workspace, ownership, target version, enabled connection, and runner enrollment, and dispatch checks them again. After changing a target or rotating credentials, configure it with the current connection version and select its refreshed picker entry. A stale selection fails instead of switching providers silently.
