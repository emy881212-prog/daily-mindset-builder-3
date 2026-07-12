# Migration Validation Report

## Summary

- Mapping expansion implemented in auth layer for:
  - patternresponses
  - patternsnapshots
  - questionnaire results
  - onboarding answers
- Explicit mood/journal mappings added for:
  - dailyMindsetJournalEntry
  - mood tracker entries
  - mood history
  - mood statistics

## LocalStorage Key Mapping Matrix

| LocalStorage Key | Firestore Destination | Migrated? |
|---|---|---|
| dailyMindsetCoachChatHistoryV1 | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetCoachChatHistoryV1); users/{uid}/categories/journal_entries (data.dailyMindsetCoachChatHistoryV1) | Yes |
| dailyMindsetDailyReflection | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetDailyReflection); users/{uid}/categories/journal_entries (data.dailyMindsetDailyReflection) | Yes |
| dailyMindsetDeviceId | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetDeviceId) | Yes |
| dailyMindsetExportPreferences | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetExportPreferences); users/{uid}/categories/settings (data.dailyMindsetExportPreferences) | Yes |
| dailyMindsetGoalsAndDreams | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetGoalsAndDreams); users/{uid}/categories/goals (data.dailyMindsetGoalsAndDreams) | Yes |
| dailyMindsetGratitudeJournal | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetGratitudeJournal); users/{uid}/categories/gratitude_journal (data.dailyMindsetGratitudeJournal); users/{uid}/categories/journal_entries (data.dailyMindsetGratitudeJournal) | Yes |
| dailyMindsetJournalEntry | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetJournalEntry); users/{uid}/categories/journal_entries (data.dailyMindsetJournalEntry); users/{uid}/categories/mood_tracker (data.dailyMindsetJournalEntry) | Yes |
| dailyMindsetJournalHistory | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetJournalHistory); users/{uid}/categories/journal_entries (data.dailyMindsetJournalHistory) | Yes |
| dailyMindsetMoodEnergyResponses | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetMoodEnergyResponses); users/{uid}/categories/mood_tracker (data.dailyMindsetMoodEnergyResponses) | Yes |
| dailyMindsetMoodEnergySnapshots | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetMoodEnergySnapshots); users/{uid}/categories/mood_tracker (data.dailyMindsetMoodEnergySnapshots) | Yes |
| dailyMindsetPatternResponses | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetPatternResponses); users/{uid}/categories/questionnaire_results (data.dailyMindsetPatternResponses) | Yes |
| dailyMindsetPatternSnapshots | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetPatternSnapshots); users/{uid}/categories/questionnaire_results (data.dailyMindsetPatternSnapshots) | Yes |
| dailyMindsetSavedQuotes | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetSavedQuotes); users/{uid}/categories/saved_quotes (data.dailyMindsetSavedQuotes) | Yes |
| dailyMindsetSmartReminderTriggersV1 | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetSmartReminderTriggersV1); users/{uid}/categories/settings (data.dailyMindsetSmartReminderTriggersV1) | Yes |
| dailyMindsetSmartRemindersV1 | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetSmartRemindersV1); users/{uid}/categories/settings (data.dailyMindsetSmartRemindersV1) | Yes |
| dailyMindsetSmartRemindersV2 | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetSmartRemindersV2); users/{uid}/categories/settings (data.dailyMindsetSmartRemindersV2) | Yes |
| dailyMindsetWeeklyGrowthV1 | users/{uid}/app_state/local_storage_snapshot (snapshot.dailyMindsetWeeklyGrowthV1); users/{uid}/categories/journal_entries (data.dailyMindsetWeeklyGrowthV1) | Yes |
| freeQuotesUsed | users/{uid}/app_state/local_storage_snapshot (snapshot.freeQuotesUsed); users/{uid}/categories/subscription_status (data.freeQuotesUsed) | Yes |
| mindsetAuth:accounts:v1 | Reserved local auth key (excluded by migration) | No |
| mindsetAuth:activeDataUserId | Reserved local auth key (excluded by migration) | No |
| mindsetAuth:data: | Reserved local auth key prefix (excluded by migration) | No |
| mindsetAuth:firebaseReady | Reserved local auth key (excluded by migration) | No |
| mindsetAuth:lastFirebaseUid | Reserved local auth key (excluded by migration) | No |
| mindsetAuth:session:v1 | Reserved local auth key (excluded by migration) | No |
| mindsetDeviceId | Reserved local auth key (excluded by migration) | No |
| mindsetFallbackUserId | Reserved local auth key (excluded by migration) | No |
| mindsetFirebaseConfig | users/{uid}/app_state/local_storage_snapshot (snapshot.mindsetFirebaseConfig) | Yes |
| mindsetPlan | users/{uid}/app_state/local_storage_snapshot (snapshot.mindsetPlan); users/{uid}/categories/subscription_status (data.mindsetPlan) | Yes |
| mindsetSubscription | users/{uid}/app_state/local_storage_snapshot (snapshot.mindsetSubscription); users/{uid}/categories/subscription_status (data.mindsetSubscription) | Yes |
| mindsetUserEmail | Reserved local auth key (excluded by migration) | No |
| mindsetUserId | Reserved local auth key (excluded by migration) | No |
| mindsetUserName | Reserved local auth key (excluded by migration) | No |
| savedQuotes | users/{uid}/app_state/local_storage_snapshot (snapshot.savedQuotes); users/{uid}/categories/saved_quotes (data.savedQuotes) | Yes |

## User-Generated Content Local-Only Check

- Journal entries: mapped and migrated.
- Mood tracker: mapped and migrated.
- Gratitude journal: mapped and migrated.
- Goals: mapped and migrated.
- Saved quotes: mapped and migrated.
- Questionnaire answers: mapped and migrated.
- Subscription status: mapped and migrated.
- User profile:
  - Canonical profile is written to users/{uid}.profile from Firebase Auth user.
  - Legacy local keys mindsetUserId/mindsetUserEmail/mindsetUserName remain local cache keys and are intentionally excluded.

## Remaining Blocker

Operational migration cannot be marked complete until Firebase credentials are real and backend services are configured.
