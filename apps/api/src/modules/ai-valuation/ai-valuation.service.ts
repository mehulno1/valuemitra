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

function parseAIResponse(text: string): Omit<AIValuationResult, 'generatedAt' | 'modelVersion'> {
  // Attempt to extract JSON block from Claude's response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
      return {
        suggestedValueLow: Number(parsed['suggestedValueLow'] ?? 0),
        suggestedValueMid: Number(parsed['suggestedValueMid'] ?? 0),
        suggestedValueHigh: Number(parsed['suggestedValueHigh'] ?? 0),
        confidenceLevel: (['HIGH', 'MEDIUM', 'LOW'].includes(parsed['confidenceLevel'] as string)
          ? parsed['confidenceLevel']
          : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
        reasoning: String(parsed['reasoning'] ?? ''),
        keyFactors: Array.isArray(parsed['keyFactors']) ? (parsed['keyFactors'] as string[]) : [],
        caveats: Array.isArray(parsed['caveats']) ? (parsed['caveats'] as string[]) : [],
      };
    } catch {
      // Fall through to text parsing
    }
  }

  // Fallback: return the raw text as reasoning with zeroed values
  return {
    suggestedValueLow: 0,
    suggestedValueMid: 0,
    suggestedValueHigh: 0,
    confidenceLevel: 'LOW',
    reasoning: text,
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
  let valuationRun = null;
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
1. A suggested value range (low, mid, high) in INR
2. Confidence level (HIGH / MEDIUM / LOW) based on data completeness
3. Key factors driving your opinion
4. Important caveats

Always respond with a JSON block followed by plain-language reasoning.

Response format:
\`\`\`json
{
  "suggestedValueLow": <number>,
  "suggestedValueMid": <number>,
  "suggestedValueHigh": <number>,
  "confidenceLevel": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "<2-3 paragraph explanation>",
  "keyFactors": ["<factor 1>", "<factor 2>", ...],
  "caveats": ["<caveat 1>", "<caveat 2>", ...]
}
\`\`\`

Important rules:
- All values must be in INR (Indian Rupees), rounded to nearest ₹1,000
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
