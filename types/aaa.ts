export type AaaStatus = 'pool' | 'registry' | 'review' | 'working' | 'archive'
export type AaaEntryKind = 'capture' | 'progress' | 'evidence' | 'review' | 'weekly_note'
export type AaaWorkflowAction = 'open' | 'beginReview' | 'approve' | 'accept' | 'freeze' | 'cancel'
export type AaaExitType = 'closing' | 'freeze' | 'terminate'
export type AaaCompletionRating = 'insufficient' | 'barely' | 'complete' | 'platinum'
export type AaaDistinction = 'I' | 'II' | 'III' | 'IV' | 'V'

export type AaaPlan = {
  whyNow?: string; core?: string; depth?: string; exploration?: string
  knowledgeLocks?: string; practiceLocks?: string; expectedOutcome?: string
  risks?: string; dependencies?: string; timeBudget?: string; closingCriteria?: string
  preliminaryResearch?: string
  weeklyGoals?: string[]
}

export type AaaEntry = { id: string; topicId: string; kind: AaaEntryKind; content: string; week: number | null; createdAt: string }
export type AaaRecord = { content: string; link: string }
export type AaaTopic = {
  id: string; title: string; description: string; records: AaaRecord[]; status: AaaStatus; question: string; why: string; scope: string; notes: string
  plan: AaaPlan; reviewStartedAt: string | null; workingStartedAt: string | null; plannedWeeks: number | null
  exitedAt: string | null; exitType: AaaExitType | null; completionRating: AaaCompletionRating | null
  distinctions: AaaDistinction[]; createdAt: string; updatedAt: string; entries: AaaEntry[]
}
