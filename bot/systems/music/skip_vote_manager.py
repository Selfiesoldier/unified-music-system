"""
Skip Vote Manager - Handles skip voting polls for music
"""
import asyncio
import math
from typing import Optional, Set


class SkipVoteManager:
    """Manages skip voting polls for music bot"""

    def __init__(self):
        self.active_vote = False
        self.voters: Set[str] = set()  # Set of user IDs who voted
        self.vote_threshold = 0.4  # 40% of total users
        self.vote_task: Optional[asyncio.Task] = None
        self.admin_cancelled = False

    def start_vote(self, initiator_id: str) -> bool:
        """
        Start a new skip vote
        Returns True if vote started, False if vote already active
        """
        if self.active_vote:
            return False

        self.active_vote = True
        self.voters = {initiator_id}  # Initiator auto-votes yes
        self.admin_cancelled = False
        return True

    def add_vote(self, user_id: str) -> bool:
        """
        Add a vote from a user
        Returns True if vote was added, False if user already voted
        """
        if user_id in self.voters:
            return False

        self.voters.add(user_id)
        return True

    def check_threshold(self, total_users: int) -> bool:
        """
        Check if vote has reached the required threshold
        Returns True if threshold met or exceeded
        """
        if total_users == 0:
            return False

        current_percentage = len(self.voters) / total_users
        return current_percentage >= self.vote_threshold

    def cancel_vote_by_admin(self) -> bool:
        """
        Cancel the vote by admin command
        Returns True if vote was active and cancelled
        """
        if not self.active_vote:
            return False

        self.admin_cancelled = True
        self.end_vote()
        return True

    def end_vote(self):
        """End the current vote session"""
        self.active_vote = False
        self.voters.clear()
        if self.vote_task and not self.vote_task.done():
            self.vote_task.cancel()
        self.vote_task = None

    def get_vote_status(self, total_users: int) -> dict:
        """
        Get current vote status
        Returns dict with vote info
        """
        # Use ceiling to round up - 80% of 2 users = 2 needed, not 1
        needed = max(1, math.ceil(total_users * self.vote_threshold))
        return {
            'active':
            self.active_vote,
            'votes':
            len(self.voters),
            'needed':
            needed,
            'total_users':
            total_users,
            'percentage':
            (len(self.voters) / total_users * 100) if total_users > 0 else 0
        }
