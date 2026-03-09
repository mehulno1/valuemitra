/**
 * AI Valuation Service
 * Calls Claude API (claude-sonnet-4-6) to provide advisory valuation guidance.
 * IMPORTANT: AI output is ADVISORY ONLY — it never overrides the RV's decision.
 * The result is stored in ValuationRun.aiValuationResult for audit trail.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { NotFoundError, AppError } from '../../middleware/error.middleware.js';
import type { RequestAIValuationInput, AIValuationResult } from '@valuemitra/shared';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// Build structured prompt context
// ─────────────────────────────────────────────

function buildPrompt(data: {
  assignment: Record<string, unknown>;
  property: Record<string, unknown> | null;
  valuationRun: Record<string, unknown> | null;
  additionalContext?: string;
}): string {
  const { assignment, property, valuationRun, additionalContext } = data;

  const sections: string[] = [];

  // Assignment context
  sections.push(`## Assignment Details
- Purpose of Valuation: ${assignment['purposeOfValuation'] ?? 'Not specified'}
- Property Type: ${assignment['propertyType'] ?? 'Not specified'}
- Inspection Date: ${assignment['inspectionDate'] ? new Date(assignment['inspectionDate'] as string).toLocaleDateString('en-IN') : 'Not set'}
- Assignment Status: ${assignment['status'] ?? 'Unknown'}`);

  // Property context
  if (property) {
    sections.push(`## Property Details
- Address: ${[property['addressLine1'], property['addressLine2'], property['city'], property['district'], property['state'], property['pincode']].filter(Boolean).join(', ')}
- Property Type: ${property['propertyType'] ?? 'Not specified'}
- Structure Type: ${property['structureType'] ?? 'Not specified'}
- Age of Building: ${property['ageOfBuilding'] !== null && property['ageOfBuilding'] !== undefined ? `${property['ageOfBuilding']} years` : 'Not specified'}
- Plot Area: ${property['landAreaSqM'] ? `${property['landAreaSqM']} sq.m.` : 'Not specified'}
- Built-Up Area: ${property['builtUpAreaSqM'] ? `${property['builtUpAreaSqM']} sq.m.` : 'Not specified'}
- Floor: ${property['flatNo'] ?? 'N/A'}
- Number of Floors: ${property['numberOfFloors'] ?? 'Not specified'}
- Zoning Classification: ${property['zoningClassification'] ?? 'Not specified'}
- Municipal Number: ${property['municipalNo'] ?? 'Not specified'}`);
  }

  // Valuation run context — include computed approach values
  if (valuationRun) {
    const parts: string[] = ['## Computed Valuation Approach Results'];

    const correlatedValue = valuationRun['correlatedValue'];
    if (correlatedValue) {
      parts.push(`- Market Comparison Value: ₹${Number(correlatedValue).toLocaleString('en-IN')}`);
    }

    const costApproachValue = valuationRun['costApproachValue'];
    if (costApproachValue) {
      parts.push(`- Cost Approach Value: ₹${Number(costApproachValue).toLocaleString('en-IN')}`);
      const depMethod = valuationRun['depreciationMethod'];
      const depRate = valuationRun['depreciationRate'];
      if (depMethod && depRate) {
        parts.push(`  - Depreciation Method: ${depMethod}, Rate: ${(Number(depRate) * 100).toFixed(1)}%`);
      }
    }

    const incomeApproachValue = valuationRun['incomeApproachValue'];
    if (incomeApproachValue) {
      parts.push(`- Income Approach Value: ₹${Number(incomeApproachValue).toLocaleString('en-IN')}`);
      const capRate = valuationRun['capitalizationRate'];
      if (capRate) {
        parts.push(`  - Capitalization Rate: ${(Number(capRate) * 100).toFixed(2)}%`);
      }
    }

    const weightedValue = valuationRun['weightedValue'];
    if (weightedValue) {
      parts.push(`- Weighted/Finalized Value: ₹${Number(weightedValue).toLocaleString('en-IN')}`);
    }

    if (parts.length > 1) {
      sections.push(parts.join('\n'));
    } else {
      sections.push('## Computed Valuation Approach Results\n- No approach values computed yet.');
    }
  }

  if (additionalContext) {
    sections.push(`## Additional Context from Valuer\n${additionalContext}`);
  }

  return sections.join('\n\n');
}

// ─────────────────────────────────────────────
// Parse Claude's structured response
// ─────────────────────────────────────────────

function extractStructured(parsed: Record<string, unknown>): Omit<AIValuationResult, 'generatedAt' | 'modelVersion'> {
  return {
    suggestedValueLow: Number(parsed['suggestedValueLow'] ?? 0),
    suggestedValueMid: Number(parsed['suggestedValueMid'] ?? 0),
    suggestedValueHigh: Number(parsed['suggestedValueHigh'] ?? 0),
    suggestedLandRateMarket: parsed['suggestedLandRateMarket'] != null && Number(parsed['suggestedLandRateMarket']) > 0
      ? Number(parsed['suggestedLandRateMarket']) : undefined,
    suggestedLandRateGovt: parsed['suggestedLandRateGovt'] != null && Number(parsed['suggestedLandRateGovt']) > 0
      ? Number(parsed['suggestedLandRateGovt']) : undefined,
    confidenceLevel: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed['confidenceLevel'] as string)
      ? parsed['confidenceLevel'] : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
    reasoning: String(parsed['reasoning'] ?? ''),
    keyFactors: Array.isArray(parsed['keyFactors']) ? (parsed['keyFactors'] as string[]) : [],
    caveats: Array.isArray(parsed['caveats']) ? (parsed['caveats'] as string[]) : [],
  };
}

function tryParseJson(jsonStr: string): Record<string, unknown> | null {
  // Attempt 1: direct parse
  try { return JSON.parse(jsonStr) as Record<string, unknown>; } catch { /* fall through */ }
  // Attempt 2: replace literal \n inside strings (unescaped newlines)
  try {
    const cleaned = jsonStr.replace(/[\r\n\t]/g, (c) =>
      c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t',
    );
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch { return null; }
}

function parseAIResponse(text: string): Omit<AIValuationResult, 'generatedAt' | 'modelVersion'> {
  // Strategy 1: look for ```json ... ``` or ``` ... ``` block (greedy to handle nested content)
  const codeBlockPatterns = [
    /```json\s*([\s\S]+?)\s*```/,
    /```\s*([\s\S]+?)\s*```/,
  ];
  for (const pattern of codeBlockPatterns) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const parsed = tryParseJson(m[1].trim());
      if (parsed && ('suggestedValueLow' in parsed || 'suggestedValueMid' in parsed)) {
        return extractStructured(parsed);
      }
    }
  }

  // Strategy 2: find the first `{` to the last `}` and parse as JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = text.slice(firstBrace, lastBrace + 1);
    const parsed = tryParseJson(jsonCandidate);
    if (parsed && ('suggestedValueLow' in parsed || 'suggestedValueMid' in parsed)) {
      return extractStructured(parsed);
    }
  }

  // Strategy 3: extract individual values via regex as last resort
  const getNum = (key: string) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const getStr = (key: string): string => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return m?.[1] ?? '';
  };
  const low = getNum('suggestedValueLow');
  if (low > 0) {
    return {
      suggestedValueLow: low,
      suggestedValueMid: getNum('suggestedValueMid'),
      suggestedValueHigh: getNum('suggestedValueHigh'),
      suggestedLandRateMarket: getNum('suggestedLandRateMarket') || undefined,
      suggestedLandRateGovt: getNum('suggestedLandRateGovt') || undefined,
      confidenceLevel: (['HIGH', 'MEDIUM', 'LOW'].includes(getStr('confidenceLevel'))
        ? getStr('confidenceLevel') : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      reasoning: getStr('reasoning') || text.slice(0, 1000),
      keyFactors: [],
      caveats: [],
    };
  }

  // Final fallback: strip the JSON block from reasoning text so UI doesn't show raw JSON
  const reasoningText = text
    .replace(/```(?:json)?[\s\S]*?```/g, '')
    .replace(/\{[\s\S]*\}/g, '')
    .trim();
  return {
    suggestedValueLow: 0,
    suggestedValueMid: 0,
    suggestedValueHigh: 0,
    confidenceLevel: 'LOW',
    reasoning: reasoningText || text,
    keyFactors: [],
    caveats: ['AI response could not be parsed into structured format. Please review the reasoning text.'],
  };
}

// ─────────────────────────────────────────────
// Main AI Valuation Request
// ─────────────────────────────────────────────

export async function requestAIValuation(
  input: RequestAIValuationInput,
  tenantId: string,
  userId: string,
): Promise<AIValuationResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'AI valuation service is not configured. Set ANTHROPIC_API_KEY in environment.');
  }

  // Fetch assignment + property (tenant-scoped)
  const assignment = await prisma.assignment.findFirst({
    where: { id: input.assignmentId, tenantId },
    include: { property: true },
  });
  if (!assignment) throw new NotFoundError('Assignment');

  // Fetch valuation run if provided
  let valuationRun: Awaited<ReturnType<typeof prisma.valuationRun.findFirst>> = null;
  if (input.valuationRunId) {
    valuationRun = await prisma.valuationRun.findFirst({
      where: { id: input.valuationRunId, assignment: { tenantId } },
    });
    if (!valuationRun) throw new NotFoundError('Valuation run');
  }

  const promptContext = buildPrompt({
    assignment: assignment as unknown as Record<string, unknown>,
    property: assignment.property as unknown as Record<string, unknown> | null,
    valuationRun: valuationRun as unknown as Record<string, unknown> | null,
    additionalContext: input.additionalContext,
  });

  const systemPrompt = `You are an expert Indian property valuation advisor with deep knowledge of IBBI (Insolvency and Bankruptcy Board of India) regulations, RVO standards, and Indian real estate market dynamics.

You are assisting a Registered Valuer (RV) with an advisory opinion. Your output is SUPPLEMENTARY and does NOT replace the RV's professional judgment.

Given the property details and computed valuation approach results, provide:
1. A suggested value range (low, mid, high) in INR for the overall property
2. Suggested land rate per sq.m. — both market rate and government ready reckoner (circle rate) based on the locality
3. Confidence level (HIGH / MEDIUM / LOW) based on data completeness
4. Key factors driving your opinion
5. Important caveats

Always respond with a JSON block followed by plain-language reasoning.

Response format:
\`\`\`json
{
  "suggestedValueLow": <number>,
  "suggestedValueMid": <number>,
  "suggestedValueHigh": <number>,
  "suggestedLandRateMarket": <number or null>,
  "suggestedLandRateGovt": <number or null>,
  "confidenceLevel": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "<2-3 paragraph explanation>",
  "keyFactors": ["<factor 1>", "<factor 2>", ...],
  "caveats": ["<caveat 1>", "<caveat 2>", ...]
}
\`\`\`

Important rules:
- All monetary values in INR (Indian Rupees), land rates rounded to nearest ₹100, property values to nearest ₹1,000
- suggestedLandRateMarket: current market land rate per sq.m. for the locality based on city/area/property type
- suggestedLandRateGovt: approximate government ready reckoner / circle rate per sq.m. (typically 60-80% of market rate in most Indian cities)
- If location data is insufficient to estimate land rates, set those fields to null
- Factor in Indian market conventions (circle rates, ready reckoner, stamp duty implications)
- If data is insufficient, reflect this in LOW confidence and wider value range
- Never present AI output as definitive — always frame as advisory
- Reference IBBI valuation standards where applicable`;

  const message = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Please provide an advisory valuation opinion for the following property:\n\n${promptContext}`,
      },
    ],
  });

  // Extract text from response
  const textContent = message.content.find((block) => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new AppError(502, 'AI service returned an unexpected response format');
  }

  const parsed = parseAIResponse(textContent.text);
  const result: AIValuationResult = {
    ...parsed,
    generatedAt: new Date(),
    modelVersion: message.model,
  };

  // Persist to ValuationRun if a run ID was provided
  if (input.valuationRunId) {
    await prisma.valuationRun.update({
      where: { id: input.valuationRunId },
      data: {
        aiValuationResult: result as unknown as object,
      },
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// Get previously stored AI result for a run
// ─────────────────────────────────────────────

export async function getStoredAIResult(
  valuationRunId: string,
  tenantId: string,
): Promise<AIValuationResult | null> {
  const run = await prisma.valuationRun.findFirst({
    where: { id: valuationRunId, assignment: { tenantId } },
    select: { aiValuationResult: true },
  });
  if (!run) throw new NotFoundError('Valuation run');
  return (run.aiValuationResult as unknown as AIValuationResult) ?? null;
}
