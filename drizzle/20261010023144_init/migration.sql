CREATE TABLE `aaa_entries` (
	`id` text PRIMARY KEY,
	`topicId` text NOT NULL,
	`kind` text DEFAULT 'capture' NOT NULL,
	`content` text NOT NULL,
	`week` integer,
	`createdAt` text NOT NULL,
	CONSTRAINT `fk_aaa_entries_topicId_aaa_topics_id_fk` FOREIGN KEY (`topicId`) REFERENCES `aaa_topics`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `aaa_topics` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`records` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pool' NOT NULL,
	`question` text DEFAULT '' NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`plan` text DEFAULT '{}' NOT NULL,
	`reviewStartedAt` text,
	`workingStartedAt` text,
	`plannedWeeks` integer,
	`exitedAt` text,
	`exitType` text,
	`completionRating` text,
	`distinctions` text DEFAULT '[]' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_sessions` (
	`id` text PRIMARY KEY,
	`workItemId` text NOT NULL,
	`startedAt` text NOT NULL,
	`endedAt` text,
	`endReason` text,
	`note` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_execution_sessions_workItemId_work_items_id_fk` FOREIGN KEY (`workItemId`) REFERENCES `work_items`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `focus_modes` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`includeTags` text DEFAULT '["*"]' NOT NULL,
	`excludeTags` text DEFAULT '[]' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todo_tags` (
	`todoId` text NOT NULL,
	`tagId` text NOT NULL,
	`createdAt` text NOT NULL,
	CONSTRAINT `todo_tags_pk` PRIMARY KEY(`todoId`, `tagId`),
	CONSTRAINT `fk_todo_tags_todoId_todos_id_fk` FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_todo_tags_tagId_tags_id_fk` FOREIGN KEY (`tagId`) REFERENCES `tags`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `todo_time_links` (
	`id` text PRIMARY KEY,
	`todoId` text NOT NULL,
	`grain` text NOT NULL,
	`date` text NOT NULL,
	`createdAt` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_todo_time_links_todoId_todos_id_fk` FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON DELETE CASCADE,
	CONSTRAINT `todo_time_links_todoId_grain_date_unique` UNIQUE(`todoId`,`grain`,`date`)
);
--> statement-breakpoint
CREATE TABLE `todo_time_spans` (
	`id` text PRIMARY KEY,
	`todoId` text NOT NULL,
	`startedAt` text NOT NULL,
	`endedAt` text,
	`createdAt` text NOT NULL,
	CONSTRAINT `fk_todo_time_spans_todoId_todos_id_fk` FOREIGN KEY (`todoId`) REFERENCES `todos`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY,
	`parentId` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`estimatedMinutes` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'action' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`startedAt` text,
	`completedAt` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`noteType` text DEFAULT 'user' NOT NULL,
	`aaaTopicId` text,
	CONSTRAINT `todos_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES `todos`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY,
	`sourceType` text NOT NULL,
	`sourceId` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scheduledDate` text NOT NULL,
	`queueOrder` integer DEFAULT 0 NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`state` text DEFAULT 'ready' NOT NULL,
	`plannedMinutes` integer NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	CONSTRAINT `work_items_sourceType_sourceId_scheduledDate_unique` UNIQUE(`sourceType`,`sourceId`,`scheduledDate`)
);
--> statement-breakpoint
CREATE INDEX `aaa_entries_topic_idx` ON `aaa_entries` (`topicId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `aaa_one_active_working` ON `aaa_topics` (`status`) WHERE "aaa_topics"."status" = 'working';--> statement-breakpoint
CREATE INDEX `idx_sessions_item` ON `execution_sessions` (`workItemId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_todo_tags_tag` ON `todo_tags` (`tagId`);--> statement-breakpoint
CREATE INDEX `idx_todo_time_links_lookup` ON `todo_time_links` (`grain`,`date`,`todoId`);--> statement-breakpoint
CREATE INDEX `idx_todo_time_spans_range` ON `todo_time_spans` (`startedAt`,`endedAt`);--> statement-breakpoint
CREATE INDEX `idx_todo_time_spans_todo` ON `todo_time_spans` (`todoId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_todo_time_spans_open` ON `todo_time_spans` (`todoId`) WHERE "todo_time_spans"."endedAt" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_todos_parent_sort` ON `todos` (`parentId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `idx_todos_status_updated` ON `todos` (`status`,"updatedAt" desc);--> statement-breakpoint
CREATE INDEX `idx_todos_kind` ON `todos` (`kind`);--> statement-breakpoint
CREATE INDEX `todos_aaa_topic_idx` ON `todos` (`aaaTopicId`);--> statement-breakpoint
CREATE INDEX `idx_work_items_today` ON `work_items` (`scheduledDate`,`queueOrder`);