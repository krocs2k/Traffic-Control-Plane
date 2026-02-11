import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const SYSTEM_PROMPT = `You are an expert traffic routing policy assistant. Help users create JSON configurations for routing policies.

You can help create two types of JSON:
1. CONDITIONS - Rules that determine when a routing policy applies
2. ACTIONS - What happens when conditions match

## CONDITION TYPES:
- "header": Match HTTP headers (operators: equals, contains, regex, exists)
- "path": Match URL paths (operators: equals, startsWith, regex)
- "query": Match query parameters (operators: equals, contains, exists)
- "geo": Match geographic regions (operators: equals, in)
- "percentage": Traffic percentage (0-100)
- "time": Time-based routing (operators: between, dayOfWeek)

## CONDITION EXAMPLES:
\`\`\`json
[
  {"type": "header", "key": "x-canary", "operator": "equals", "value": "true"},
  {"type": "path", "operator": "startsWith", "value": "/api/v2"},
  {"type": "geo", "key": "country", "operator": "in", "value": ["US", "CA"]},
  {"type": "percentage", "value": 10},
  {"type": "time", "operator": "between", "value": {"start": "09:00", "end": "17:00"}}
]
\`\`\`

## ACTION TYPES:
- "route": Route to specific backend/cluster
- "weight": Weighted distribution across backends
- "redirect": HTTP redirect
- "reject": Reject with status code
- "modify_header": Add/modify response headers
- "rate_limit": Apply rate limiting

## ACTION EXAMPLES:
\`\`\`json
[
  {"type": "route", "target": "canary-cluster", "weight": 100},
  {"type": "weight", "distribution": [{"target": "v1", "weight": 90}, {"target": "v2", "weight": 10}]},
  {"type": "redirect", "url": "/maintenance", "statusCode": 302},
  {"type": "reject", "statusCode": 403, "message": "Access denied"},
  {"type": "modify_header", "headers": {"X-Debug": "true"}},
  {"type": "rate_limit", "requests": 100, "window": "1m"}
]
\`\`\`

When the user describes what they want, respond conversationally to understand their needs, then provide the appropriate JSON.

IMPORTANT: When you're ready to provide JSON, format it clearly with \`\`\`conditions and \`\`\`actions code blocks so the system can extract them. Always ask clarifying questions if the user's requirements are unclear.

If the user says "generate" or asks you to produce the final configuration, output the JSON in the following format:
\`\`\`conditions
[...conditions array...]
\`\`\`

\`\`\`actions
[...actions array...]
\`\`\`
`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array required' }, { status: 400 });
    }

    // Use configurable LLM API endpoint (OpenAI-compatible)
    const llmBaseUrl = process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1';
    const llmApiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const llmModel = process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!llmApiKey) {
      return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 });
    }

    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages
        ],
        stream: true,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('LLM API error:', error);
      return NextResponse.json({ error: 'Failed to get AI response' }, { status: 500 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let partialRead = '';
        
        try {
          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;
            
            partialRead += decoder.decode(value, { stream: true });
            const lines = partialRead.split('\n');
            partialRead = lines.pop() || '';
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  return;
                }
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in AI assist:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
